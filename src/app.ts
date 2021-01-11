import crypto from 'crypto';
import fs from 'fs';
// import { promises as fsp } from 'fs';
import zlib from 'zlib';

import koabody from 'koa-body';
import compress from 'koa-compress';
import morgan from 'koa-morgan';
import Router from 'koa-router';
import serve from 'koa-static-server';

import cors from '@koa/cors';

import Koa from 'koa';

import { DB } from './db_mongo';

import redis from 'redis';

import axios from 'axios';
const ax = axios.create({
  headers: {
    'Accept': '*/*',
    'User-Agent': 'Mozilla/5.0',
  },
  responseType: 'arraybuffer',
});

import iconv from 'iconv-lite';

import JSZip from 'jszip';

const accessLog = fs.createWriteStream('./access.log', { flags: 'a' });

const redis_url = process.env.AOZORA_REDIS_URL || 'redis://127.0.0.1:6379';

interface Is2s {
  [index: string]: string;
}

const encodings: Is2s = {
  card: 'utf-8',
  html: 'shift_jis',
  txt: 'shift_jis',
};

const content_type: Is2s = {
  html: 'text/html; charset=shift_jis',
  txt: 'text/plain; charset=shift_jis',
};

const DEFAULT_LIMIT = 100;
const DATA_LIFETIME = 3600;

const VERSION = 'v0.1';
const API_ROOT = `/api/${VERSION}`;

//
// promisify
//
import { promisify } from 'util';

const zlib_deflate = promisify<string | Buffer, Buffer>(zlib.deflate);
const zlib_inflate = promisify<string | Buffer, Buffer>(zlib.inflate);

//
// utilities
//

function re_or_str(src: string): object | string {
  if (src[0] === '/' && src.slice(-1) === '/') {
    return new RegExp(src.slice(1, -1));
  } else {
    return src;
  }
}

function return_json(ctx: Koa.Context, doc: object) {
  const body = JSON.stringify(doc);
  ctx.response.etag = gen_etag(body);
  ctx.status = 200;

  if (ctx.fresh) {
    ctx.status = 304;
    ctx.body = null;
  } else {
    ctx.type = 'application/json; charset=utf-8';
    ctx.body = body;
  }
}

function add_ogp(body: string, title: string, author: string): string {
  const ogp_headers =
    ['<head prefix="og: http://ogp.me/ns#">',
      '<meta name="twitter:card" content="summary" />',
      '<meta property="og:type" content="book">',
      '<meta property="og:image" content="http://www.aozora.gr.jp/images/top_logo.png">',
      '<meta property="og:image:type" content="image/png">',
      '<meta property="og:image:width" content="100">',
      '<meta property="og:image:height" content="100">',
      '<meta property="og:description" content="...">',
      `<meta property="og:title" content="${title}(${author})"`].join('\n');

  return body.replace(/<head>/, ogp_headers);
}

function rel_to_abs_path(body: string, ext: string) {
  if (ext === 'card') {
    return body
      .replace(/\.\.\/\.\.\//g, 'http://www.aozora.gr.jp/')
      .replace(/\.\.\//g, 'http://www.aozora.gr.jp/cards/');
  } else { // ext == 'html'
    return body
      .replace(/\.\.\/\.\.\//g, 'http://www.aozora.gr.jp/cards/');
  }
}

function gen_etag(data: Buffer | string) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

async function get_zipped(db: DB, book_id: number, _: string): Promise<Buffer> {
  const doc = await db.find_one_book(book_id, ['text_url']);
  const body = (await ax.get(doc.text_url)).data;
  const zip = await JSZip.loadAsync(body);
  const key = Object.keys(zip.files)[0]; // assuming zip has only one text entry
  return zip.file(key).async('nodebuffer');
}

async function get_ogpcard(db: DB, book_id: number, ext: string): Promise<Buffer> {
  const doc = await db.find_one_book(book_id, {
    authors: 1,
    card_url: 1,
    html_url: 1,
    title: 1,
  });
  const ext_url = doc[`${ext}_url`];
  const body = (await ax.get(ext_url)).data;
  const encoding = encodings[ext];
  const author_name = doc.authors[0].last_name + doc.authors[0].first_name;
  return iconv.encode(rel_to_abs_path(add_ogp(iconv.decode(body, encoding),
    doc.title, author_name),
    ext),
    encoding);
}

const get_file_method: { [index: string]: (db: DB, n: number, s: string) => Promise<Buffer> } = {
  card: get_ogpcard,
  html: get_ogpcard,
  txt: get_zipped,
};

//
// class
//

interface ITextTag {
  tbuf: Buffer;
  etag: string;
}

class MyApp extends Koa {
  private db: DB;
  private rc: redis.RedisClient;
  private rsetex: (key: string, seconds: number, value: string) => string;
  private rget: (key: string) => string;

  constructor(db: DB) {
    super();
    this.db = db;
    this.rc = redis.createClient(redis_url);
    this.rsetex = promisify<string, number, string, string>(this.rc.setex).bind(this.rc);
    this.rget = promisify<string, string>(this.rc.get).bind(this.rc);
    this.rc.flushall();
  }

  public async connect_db() {
    return this.db.connect();
  }

  public async find_books(query: object, options?: object) {
    return this.db.find_books(query, options);
  }

  public async find_one_book(book_id: number) {
    return this.db.find_one_book(book_id);
  }

  public async find_persons(query: object, options?: object) {
    return this.db.find_persons(query, options);
  }

  public async find_one_person(person_id: number) {
    return this.db.find_one_person(person_id);
  }

  public async find_workers(query: object, options?: object) {
    return this.db.find_workers(query, options);
  }

  public async find_one_worker(worker_id: number) {
    return this.db.find_one_worker(worker_id);
  }

  public async find_ranking(rtype: string, year_month: string) {
    return this.db.find_ranking(rtype, year_month);
  }

  public async get_from_cache(book_id: number, ext: string): Promise<ITextTag> {
    const get_file = get_file_method[ext];
    const key = `${ext}${book_id}`;
    const etag = await this.rget(key);
    if (etag) {
      const data = Buffer.from(await this.rget(key + ':d'), 'binary');
      const buf = await zlib_inflate(data);
      return {
        etag,
        tbuf: buf,
      };
    } else {
      const data = await get_file(this.db, book_id, ext);
      return await this._upload_content_data(key, data);
    }
  }

  private async _upload_content_data(key: string, data: Buffer): Promise<ITextTag> {
    const zdata = (await zlib_deflate(data)).toString('binary');
    const etag = gen_etag(data);

    await this.rsetex(key + ':d', DATA_LIFETIME, zdata);
    await this.rsetex(key, DATA_LIFETIME, etag);

    return {
      etag,
      tbuf: data,
    };
  }

}

//
// Interface
//
interface Iquery {
  title?: string | object;
  name?: string | object;
  release_date?: object;
  $or?: object[];
  'authors.person_id'?: object;
}
interface Ioptions {
  sort?: object;
  limit?: number;
  skip?: number;
}

//
/// router
//
function make_router(app: MyApp) {
  const router = new Router({ prefix: API_ROOT });

  //
  // books
  //
  router.get('/books', async (ctx) => {
    const req = ctx.request;
    const query: Iquery = {};

    if (req.query.title) {
      query.title = re_or_str(req.query.title);
    }
    if (req.query.author) {
      const persons = await (await app.find_persons(
        {
          $or: [
            {first_name: req.query.author},
            {last_name: req.query.author},
            {full_name: req.query.author},
          ],
        }));
      if (persons.length === 0) {
        ctx.status = 404;
        return;
      }
      query['authors.person_id'] = { $in: (await persons).map((e) => e.person_id) };
    }

    if (req.query.after) {
      query.release_date = { $gte: new Date(req.query.after) };
    }

    const options: Ioptions = {};
    options.sort = req.query.sort ? JSON.parse(req.query.sort) : { release_date: -1 };
    options.limit = req.query.limit ? parseInt(req.query.limit, 10) : DEFAULT_LIMIT;
    if (req.query.skip) {
      options.skip = parseInt(req.query.skip, 10);
    }

    const docs = await app.find_books(query, options);
    if (docs) {
      return_json(ctx, docs);
    } else {
      ctx.body = '';
      ctx.status = 404;
    }
  });

  router.get('/books/:book_id', async (ctx, next) => {
    // tslint:disable-next-line: no-console
    console.log(decodeURIComponent(ctx.req.url));

    const book_id = parseInt(ctx.params.book_id, 10);
    if (!book_id) {
      next();
      return;
    }
    const doc = await app.find_one_book(book_id);
    if (doc) {
      return_json(ctx, doc);
    } else {
      ctx.body = '';
      ctx.status = 404;
    }
  });

  router.get('/books/:book_id/card', async (ctx) => {
    // tslint:disable-next-line: no-console
    console.log(decodeURIComponent(ctx.req.url));

    const book_id = parseInt(ctx.params.book_id, 10);
    try {
      const res = await app.get_from_cache(book_id, 'card');

      ctx.status = 200;
      ctx.response.etag = res.etag;

      if (ctx.fresh) {
        ctx.status = 304;
        ctx.body = null;
      } else {
        ctx.response.type = 'text/html';
        ctx.body = res.tbuf;
      }
    } catch (error) {
      console.error(error);
      ctx.body = '';
      ctx.status = 404;
    }
  });

  router.get('/books/:book_id/content', async (ctx) => {
    // tslint:disable-next-line: no-console
    console.log(decodeURIComponent(ctx.req.url));

    const book_id = parseInt(ctx.params.book_id, 10);
    const ext = ctx.query.format || 'txt';
    try {
      const res = await app.get_from_cache(book_id, ext);

      ctx.status = 200;
      ctx.response.etag = res.etag;

      if (ctx.fresh) {
        ctx.status = 304;
        ctx.body = null;
      } else {
        ctx.response.type = content_type[ext] || 'application/octet-stream';
        ctx.body = res.tbuf;

        // const wfh = await fsp.open('./a' + book_id + '.' + ext, 'w');
        // await wfh.writeFile(ctx.body, { encoding: 'binary' });

      }
    } catch (error) {
      console.error(error);
      ctx.body = '';
      ctx.status = 404;
    }
  });

  //
  // persons
  //
  router.get('/persons', async (ctx) => {
    // tslint:disable-next-line: no-console
    console.log(decodeURIComponent(ctx.req.url));

    const req = ctx.request;
    const query: Iquery = {};

    if (req.query.name) {
      query.$or = [
            {first_name: req.query.name},
            {last_name: req.query.name},
            {full_name: req.query.name},
          ];
    }

    const docs = await app.find_persons(query);
    if (docs) {
      return_json(ctx, docs);
    } else {
      ctx.body = '';
      ctx.status = 404;
    }
  });

  router.get('/persons/:person_id', async (ctx, next) => {
    // tslint:disable-next-line: no-console
    console.log(decodeURIComponent(ctx.req.url));

    const person_id = parseInt(ctx.params.person_id, 10);
    if (!person_id) {
      next();
      return;
    }
    const doc = await app.find_one_person(person_id);
    if (doc) {
      return_json(ctx, doc);
    } else {
      ctx.body = '';
      ctx.status = 404;
    }
  });

  //
  // workers
  //
  router.get('/workers', async (ctx) => {
    // tslint:disable-next-line: no-console
    console.log(decodeURIComponent(ctx.req.url));

    const req = ctx.request;
    const query: Iquery = {};

    if (req.query.name) {
      query.name = re_or_str(req.query.name);
    }

    const docs = await app.find_workers(query);
    if (docs) {
      return_json(ctx, docs);
    } else {
      ctx.body = '';
      ctx.status = 404;
    }
  });

  router.get('/workers/:worker_id', async (ctx, next) => {
    // tslint:disable-next-line: no-console
    console.log(decodeURIComponent(ctx.req.url));

    const worker_id = parseInt(ctx.params.worker_id, 10);
    if (!worker_id) {
      next();
      return;
    }
    const doc = await app.find_one_worker(worker_id);
    if (doc) {
      return_json(ctx, doc);
    } else {
      ctx.body = '';
      ctx.status = 404;
    }
  });

  //
  // ranking
  //
  router.get('/ranking/:type/:year/:month', async (ctx) => {
    // tslint:disable-next-line: no-console
    console.log(decodeURIComponent(ctx.req.url));

    const docs = await app.find_ranking(ctx.params.type,
      ctx.params.year + '_' + ctx.params.month);
    if (docs.length > 0) {
      return_json(ctx, docs);
    } else {
      ctx.body = '';
      ctx.status = 404;
    }
  });

  return router;
}
//
// functions
//
export async function make_app(): Promise<Koa> {
  const app = new MyApp(new DB());
  //
  // middleware
  //
  app.use(cors());
  app.use(compress());
  app.use(morgan('combined', { stream: accessLog }));
  app.use(koabody());

  await app.connect_db();

  const router = make_router(app);
  app
    .use(router.routes())
    .use(router.allowedMethods());

  app.use(serve({ rootDir: './public', rootPath: API_ROOT }));

  app.use((ctx: Koa.Context) => {
    ctx.body = 'Hello, Koa from TypeScript!';
  });

  return app;
}
