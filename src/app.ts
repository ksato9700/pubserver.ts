import crypto from 'crypto';
import fs from 'fs';

import koabody from 'koa-body';
import compress from 'koa-compress';
import morgan from 'koa-morgan';
import Router from 'koa-router';
import serve from 'koa-static-server';

import cors from '@koa/cors';

import Koa from 'koa';

import {DB} from './db_mongo';

const accessLog = fs.createWriteStream('./access.log', { flags: 'a' });

const VERSION = 'v0.1';
const API_ROOT = `/api/${VERSION}`;

function gen_etag(data: string) {
  return crypto.createHash('sha1').update(data).digest('hex');
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

class MyApp extends Koa {
  private db: DB;

  constructor(db: DB) {
    super();
    this.db = db;
  }

  public async connect_db() {
    return this.db.connect();
  }
  public async find_one_book(book_id: number) {
    return this.db.find_one_book(book_id, {});
  }
}

function make_router(app: MyApp) {
  const router = new Router({prefix: API_ROOT});

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
  return router;
}

export async function make_app(): Promise<Koa> {
  const app = new MyApp(new DB());
  //
  // middleware
  //
  app.use(cors());
  app.use(compress());
  app.use(morgan('combined', { stream: accessLog}));
  app.use(koabody());

  await app.connect_db();

  const router = make_router(app);
  app
    .use(router.routes())
    .use(router.allowedMethods());

  app.use(serve({rootDir: './public', rootPath: API_ROOT}));

  app.use((ctx: Koa.Context) => {
    ctx.body = 'Hello, Koa from TypeScript!';
  });

  return app;
}
