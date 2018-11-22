import {make_app} from './app';

async function run_app() {
  const app = await make_app();
  app.listen(process.env.PORT || 5000);
}

run_app();
