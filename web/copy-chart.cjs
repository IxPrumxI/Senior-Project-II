const { copyFileSync, mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

const source = resolve(__dirname, "node_modules/chart.js/dist/chart.umd.js");
const destination = resolve(__dirname, "public/vendor/chart.umd.js");

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
