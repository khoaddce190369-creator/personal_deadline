const { createClient } = require('@libsql/client');
const config = require('./config');

const db = createClient({
  url: config.dbUrl,
  authToken: config.dbAuthToken,
});

async function dropAndRecreate() {
  await db.execute('DROP TABLE IF EXISTS deadlines');
  console.log('Dropped deadlines table');
}

dropAndRecreate();
