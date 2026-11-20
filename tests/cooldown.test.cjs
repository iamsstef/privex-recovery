"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {secondsRemaining,formatRemaining}=require("../cooldown.js");
test("shows time remaining in seconds using the on-chain Unix timestamp",()=>{
  const now=1_795_130_000_000;
  assert.equal(secondsRemaining(1_795_133_661,now),3661);
  assert.equal(formatRemaining(3661),"1h 01m 01s");
  assert.equal(formatRemaining(59),"0m 59s");
  assert.equal(formatRemaining(90061),"1d 01h 01m 01s");
});
test("becomes ready on expiry and never displays a negative countdown",()=>{
  const now=1_795_130_000_000;
  assert.equal(secondsRemaining(1_795_130_000,now),0);
  assert.equal(secondsRemaining(1_795_129_999,now),0);
  assert.equal(formatRemaining(0),"Ready");
});
test("counts down across second boundaries",()=>{
  const deadline=1_795_130_002;
  assert.equal(secondsRemaining(deadline,1_795_130_000_001),2);
  assert.equal(secondsRemaining(deadline,1_795_130_001_001),1);
  assert.equal(secondsRemaining(deadline,1_795_130_002_000),0);
});
test("rejects missing or invalid deadline values",()=>{
  assert.equal(secondsRemaining(null),null);
  assert.equal(secondsRemaining(""),null);
  assert.equal(secondsRemaining("nope"),null);
  assert.equal(secondsRemaining(Number.MAX_SAFE_INTEGER+10),null);
});