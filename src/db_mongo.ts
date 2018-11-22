import * as dotenv from 'dotenv';
dotenv.config();

import * as mongodb from 'mongodb';

const mongodb_credential = process.env.AOZORA_MONGODB_CREDENTIAL || '';
const mongodb_host = process.env.AOZORA_MONGODB_HOST || 'localhost';
const mongodb_port = process.env.AOZORA_MONGODB_PORT || '27017';
const mongo_url = `mongodb://${mongodb_credential}${mongodb_host}:${mongodb_port}/aozora`;

export class DB {
  private db: mongodb.Db;

  public async connect() {
    return mongodb.MongoClient.connect(mongo_url, {useNewUrlParser: true})
      .then((client) => {
        this.db = client.db();
      });
  }

  public find_one_book(book_id: number, options: mongodb.FindOneOptions) {
    return this._find_one('books', {book_id}, options);
  }

  private _find_one(collection: string, query: object, options: mongodb.FindOneOptions) {
    options = options || {};
    if (Array.isArray(options.projection)) {
      options.projection = Object.assign(
        {_id: 0}, ... (options.projection || []).map((e) => ({[e]: 1})));
    } else {
      options.projection = Object.assign({_id: 0}, options.projection || {});
    }
    return this.db.collection(collection).findOne(query, options);
  }

}
