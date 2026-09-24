// Forgotten password: removes the login and signs everyone out, so the next
// visit to the web UI shows the first-run "create a login" screen again.
// Settings, destinations and events are untouched.
//
//   Docker:  docker exec arr-digest node server/dist/cli/reset-auth.js
//   Dev:     npm run reset-auth
import { bootstrapDb } from "../db/bootstrap.js";
import { clearCredentials, getCredentials } from "../auth/service.js";

bootstrapDb();
const had = getCredentials();
clearCredentials();
console.log(
  had
    ? `Removed the login for "${had.username}". Open the web UI to create a new one.`
    : "There was no login set. Open the web UI to create one.",
);
