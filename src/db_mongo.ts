import * as dotenv from 'dotenv';
dotenv.config();

import * as mongodb from 'mongodb';

const mongodb_credential = process.env.AOZORA_MONGODB_CREDENTIAL || '';
const mongodb_host = process.env.AOZORA_MONGODB_HOST || 'localhost';
const mongodb_port = process.env.AOZORA_MONGODB_PORT || '27017';
const mongodb_replica_set = process.env.AOZORA_MONGODB_REPLICA_SET;
const mongo_url = `mongodb://${mongodb_credential}${mongodb_host}:${mongodb_port}/aozora`;

//
// utilities
//
function adjust_options(options: mongodb.FindOneOptions = {}) {
  if (Array.isArray(options.projection)) {
    options.projection = Object.assign(
      { _id: 0 }, ... (options.projection || []).map((e) => ({ [e]: 1 })));
  } else {
    options.projection = Object.assign({ _id: 0 }, options.projection || {});
  }
  return options;
}

//
// interface
//
interface Iauthor {
  first_name: string;
  last_name: string;
}

//
// class
//
export class DB {
  private db: mongodb.Db;

  public async connect() {
    const options: mongodb.MongoClientOptions = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    };
    if (mongodb_replica_set) {
        options.ssl = true;
        options.replicaSet = mongodb_replica_set;
        options.authMechanism = 'SCRAM-SHA-1';
        options.authSource = 'admin';
    }
    return mongodb.MongoClient.connect(mongo_url, options)
      .then((client) => {
        this.db = client.db();
      });
  }

  public find_books(query: object, options: object) {
    return this._find('books', query, options);
  }

  public find_one_book(book_id: number, options?: object) {
    return this._find_one('books', { book_id }, options);
  }

  public find_persons(query: object, options: object) {
    return this._find('persons', query, options);
  }

  public find_one_person(person_id: number, options?: object) {
    return this._find_one('persons', { person_id }, options);
  }

  public find_workers(query: object, options: object) {
    return this._find('workers', query, options);
  }

  public find_one_worker(worker_id: number, options?: object) {
    return this._find_one('workers', { id: worker_id }, options);
  }

  public find_ranking(rtype: string, year_month: string) {
    const collection = 'ranking_' + rtype;
    const query = {
      year_month,
    };
    const options = {
      projection: { year_month: 0 },
      sort: { access: -1 },
    };
    const book_options = { book_title: 1, authors: 1 };
    return this._find(collection, query, options)
      .then((r) => {
        return Promise.all(r.map((e) => {
          return this.find_one_book(e.book_id, book_options).then((book) => {
            return Object.assign({
              authors: book.authors.map(
                (a: Iauthor) => a.last_name + ' ' + a.first_name),
              title: book.title,
            }, e);
          });
        }));
      });
  }

  private _find(collection: string, query: object, options: mongodb.FindOneOptions) {
    return this.db.collection(collection).find(query, adjust_options(options)).toArray();
  }

  private _find_one(collection: string, query: object, options: mongodb.FindOneOptions) {
    return this.db.collection(collection).findOne(query, adjust_options(options));
  }
}
