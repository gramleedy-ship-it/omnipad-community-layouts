// node test/check.test.js - the layout check refuses what the app refuses (no network, no dependencies).
'use strict';
const assert = require('assert');
const { check, systemKey } = require('../scripts/build-index.js');

const blocked = new Set(['valorant.exe']);
const head = '; @title: T\n; @game: G\n; @family: xbox\n';
const ok = check(head + '[Profile:game.exe]\nA=key:Space\n', 'layouts/game/t.omnipad-layout', blocked);
assert.deepStrictEqual(ok.errors, [], 'a plain layout passes');
assert.strictEqual(ok.id, 'game.t');

const why = (text, rel) => check(text, rel || 'layouts/game/t.omnipad-layout', blocked).errors.join(' | ');
assert.match(why(head + '[Profile:valorant.exe]\nA=key:Space\n', 'layouts/valorant/t.omnipad-layout'), /anti-cheat/);
assert.match(why(head + '[Profile:game.exe]\nA=key:LWin\n'), /system key/);
assert.match(why(head + '[Profile:game.exe]\nMacro1=A : key:Ctrl+Alt+Delete\n'), /system key/);
assert.match(why(head + '[Profile:game.exe]\nA=key:Alt+Tab\n'), /system key/);
assert.match(why(head + '[Profile:game.exe]\nRadial1=action:taskmanager | Tasks\n'), /desktop action/);
assert.match(why(head + '[Profile:game.exe]\nAllowCompetitive=true\n'), /AllowCompetitive/);
assert.match(why(head + '[Settings]\nA=key:Space\n'), /only a \[Profile/);
assert.match(why(head + '[Profile:other.exe]\nA=key:Space\n'), /folder must be named/);
assert.match(why('[Profile:game.exe]\nA=key:Space\n'), /@title/);
assert.match(why(head.replace('xbox', 'n64') + '[Profile:game.exe]\nA=key:Space\n'), /@family/);
assert.match(why(head + '[Profile:game.exe]\n' + 'A=key:Space\n'.repeat(2000)), /KB|lines/);
assert.match(why('﻿' + head + '[Profile:game.exe]\nA=key:Space\n'), /byte order mark/);
assert.strictEqual(systemKey('A', 'key:Ctrl+C'), null, 'ordinary shortcuts are fine');
console.log('check.test.js: all passed');
