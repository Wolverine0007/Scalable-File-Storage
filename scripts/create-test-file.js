const fs = require("fs");
const crypto = require("crypto");

const FILE_PATH = "test-files/large-test.bin";
const FILE_SIZE = 50 * 1024 * 1024; // 50 MB

console.log("Generating 50 MB test file...");

const buffer = crypto.randomBytes(FILE_SIZE);

fs.writeFileSync(FILE_PATH, buffer);

console.log("✓ Test file created:");
console.log(FILE_PATH);
console.log(
    "Size:",
    (FILE_SIZE / 1024 / 1024).toFixed(2),
    "MB"
);