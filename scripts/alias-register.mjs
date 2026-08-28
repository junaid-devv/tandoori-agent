/**
 * scripts/alias-register.mjs — registers the "@/" alias resolve hook.
 * Usage: node --import ./scripts/alias-register.mjs --experimental-strip-types <script.ts|.mjs>
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-hooks.mjs", import.meta.url);
