import * as ping from "./ping.js";
import * as hello from "./hello.js";
import * as server from "./server.js";
import * as user from "./user.js";
import * as echo from "./echo.js";
import * as kick from "./kick.js";
import * as timeout from "./timeout.js";
import * as poll from "./poll.js";
import * as hangar from "./hangar.js";
import * as help from "./help.js";
import * as locate from "./locate.js";
import * as route from "./route.js";
import * as terminal from "./terminal.js";
import * as calc from "./calc.js";
import { commodityCommand, statusCommand } from "./sc.js";
import * as ship from "./sc.js";

// Adding a command: create the module, import it above, add it here,
// then run `npm run deploy`.
export const commands = [
  ship,
  statusCommand,
  commodityCommand,
  calc,
  route,
  terminal,
  locate,
  hangar,
  poll,
  help,
  ping,
  hello,
  server,
  user,
  echo,
  kick,
  timeout,
];
