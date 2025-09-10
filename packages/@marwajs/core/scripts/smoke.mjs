import { ref, reactive, computed, effect } from "../dist/index.js";

const n = ref(1);
const s = reactive({ a: 2 });
const c = computed(() => n.value + s.a);

let logs = [];
effect(() => {
  logs.push(c.value);
});

n.value = 5; // triggers effect
s.a = 3; // triggers effect

setTimeout(() => {
  console.log("logs:", logs); // expect [3, 7, 8]
}, 0);
