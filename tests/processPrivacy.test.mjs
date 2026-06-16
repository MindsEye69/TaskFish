import assert from "node:assert/strict";
import test from "node:test";
import privacy from "../dist/electron-main/processPrivacy.js";

const {
  buildPrivacySafeProcessTelemetry,
  commandLineSummary,
  escapeCimFilterLiteral,
  redactUserPath,
} = privacy;

test("redacts user-private paths before prompt telemetry", () => {
  assert.equal(
    redactUserPath("C:\\Users\\Alice\\Documents\\payroll.xlsx"),
    "%USERPROFILE%\\Documents\\*",
  );

  const payload = buildPrivacySafeProcessTelemetry({
    executablePath: "C:\\Users\\Alice\\AppData\\Local\\Temp\\runner.exe",
    parentName: "explorer.exe",
    parentPid: 100,
  });

  assert.match(payload, /Executable Location Class: user-temp/);
  assert.doesNotMatch(payload, /Alice/);
});

test("withholds command lines and flags secret-like values", () => {
  assert.equal(
    commandLineSummary("node app.js --api_key=abc123"),
    "withheld: secret-like value detected",
  );

  const payload = buildPrivacySafeProcessTelemetry({
    executablePath: "C:\\Program Files\\Example\\app.exe",
    commandLine: "app.exe --token=secret --file C:\\Users\\Alice\\Desktop\\note.txt",
  });

  assert.match(payload, /Command Line: withheld: secret-like value detected/);
  assert.doesNotMatch(payload, /abc123/);
  assert.doesNotMatch(payload, /note\.txt/);
});

test("summarizes network endpoints by address class", () => {
  const payload = buildPrivacySafeProcessTelemetry({
    tcpConnections: [
      { RemoteAddress: "93.184.216.34", RemotePort: 443, State: "Established" },
      { RemoteAddress: "192.168.1.4", RemotePort: 5353, State: "Listen" },
      { RemoteAddress: "127.0.0.1", RemotePort: 11434, State: "Established" },
    ],
  });

  assert.match(payload, /public-ip:443/);
  assert.match(payload, /private-ip:5353/);
  assert.match(payload, /loopback:11434/);
  assert.doesNotMatch(payload, /93\.184\.216\.34/);
  assert.doesNotMatch(payload, /192\.168\.1\.4/);
});

test("escapes CIM filter string literals", () => {
  assert.equal(escapeCimFilterLiteral("weird'name.exe"), "weird''name.exe");
  assert.equal(escapeCimFilterLiteral("path\\name.exe"), "path\\\\name.exe");
});
