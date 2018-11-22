import test from 'ava';
import * as supertest from 'supertest';
import {make_app} from '../src/app';

let server: supertest.SuperTest<supertest.Test>;

test.before(async t => {
  const app = await make_app();
  server = supertest.default(app.listen(0))
});

test('app:single_book', async t => {
  t.plan(35);
  let res = await server
    .get('/api/v0.1/books/123');

  t.is(res.status, 200);
  t.is(res.header['content-type'], 'application/json; charset=utf-8');
  t.is(res.body.book_id, 123);
  t.is(res.body.title, '大川の水');
  t.is(res.body.title_yomi, 'おおかわのみず');
  t.is(res.body.title_sort, 'おおかわのみす');
  t.is(res.body.first_appearance, '「心の花」1914（大正3）年4月');
  t.is(res.body.ndc_code, 'NDC 914');
  t.is(res.body.font_kana_type, '新字新仮名');
  t.is(res.body.copyright, false);
  t.is(res.body.release_date, '1999-01-11T00:00:00.000Z');
  t.is(res.body.last_modified, '2014-09-17T00:00:00.000Z');
  t.is(res.body.card_url, 'https://www.aozora.gr.jp/cards/000879/card123.html');
  t.is(res.body.base_book_1, '羅生門・鼻・芋粥');
  t.is(res.body.base_book_1_publisher, '角川文庫、角川書店');
  t.is(res.body.base_book_1_1st_edition, '1950（昭和25）年10月20日');
  t.is(res.body.base_book_1_edition_input, '1985（昭和60）年11月10日改版38版');
  t.is(res.body.base_book_1_edition_proofing, '1985（昭和60）年11月10日改版38版');
  t.is(res.body.input, 'j.utiyama');
  t.is(res.body.proofing, 'かとうかおり');
  t.is(res.body.text_url, 'https://www.aozora.gr.jp/cards/000879/files/123_ruby_1199.zip');
  t.is(res.body.text_last_modified, '2004-03-15T00:00:00.000Z');
  t.is(res.body.text_encoding, 'ShiftJIS');
  t.is(res.body.text_charset, 'JIS X 0208');
  t.is(res.body.text_updated, 2);
  t.is(res.body.html_url, 'https://www.aozora.gr.jp/cards/000879/files/123_15167.html');
  t.is(res.body.html_last_modified, '2004-03-15T00:00:00.000Z');
  t.is(res.body.html_encoding, 'ShiftJIS');
  t.is(res.body.html_charset, 'JIS X 0208');
  t.is(res.body.html_updated, 0);
  t.is(res.body.authors[0].person_id, 879);
  t.is(res.body.authors[0].last_name, '芥川');
  t.is(res.body.authors[0].first_name, '竜之介');

  res = await server
    .get('/api/v0.1/books/123')
    .set('If-None-Match', res.header.etag);

  t.is(res.status, 304);
  t.is(res.header['content-type'], undefined);
});
