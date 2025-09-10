"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vitest_1 = require("vitest");
var src_1 = require("../src");
(0, vitest_1.describe)("ref", function () {
    (0, vitest_1.it)("tracks get/set", function () {
        var n = (0, src_1.ref)(1);
        var ran = 0;
        var runner = (0, src_1.effect)(function () {
            // read
            n.value;
            ran++;
        });
        (0, vitest_1.expect)(ran).toBe(1);
        n.value = 2;
        (0, vitest_1.expect)(ran).toBe(2);
        (0, src_1.stop)(runner);
    });
});
(0, vitest_1.describe)("reactive", function () {
    (0, vitest_1.it)("proxies nested objects", function () {
        var s = (0, src_1.reactive)({ a: 1, nested: { v: 1 } });
        var seen = 0;
        var r = (0, src_1.effect)(function () {
            s.nested.v;
            seen++;
        });
        (0, vitest_1.expect)(seen).toBe(1);
        s.nested.v = 2;
        (0, vitest_1.expect)(seen).toBe(2);
        (0, src_1.stop)(r);
    });
});
(0, vitest_1.describe)("computed", function () {
    (0, vitest_1.it)("caches until invalidated", function () {
        var a = (0, src_1.ref)(1);
        var b = (0, src_1.ref)(2);
        var gets = 0;
        var c = (0, src_1.computed)(function () {
            gets++;
            return a.value + b.value;
        });
        (0, vitest_1.expect)(c.value).toBe(3);
        (0, vitest_1.expect)(c.value).toBe(3);
        (0, vitest_1.expect)(gets).toBe(1);
        a.value = 2;
        (0, vitest_1.expect)(c.value).toBe(4);
        (0, vitest_1.expect)(gets).toBe(2);
    });
});
(0, vitest_1.describe)("untrack", function () {
    (0, vitest_1.it)("prevents dependency collection", function () {
        var a = (0, src_1.ref)(1);
        var runs = 0;
        var r = (0, src_1.effect)(function () {
            runs++;
            (0, src_1.untrack)(function () { return a.value; }); // should not track
        });
        (0, vitest_1.expect)(runs).toBe(1);
        a.value = 2;
        (0, vitest_1.expect)(runs).toBe(1);
        (0, src_1.stop)(r);
    });
});
