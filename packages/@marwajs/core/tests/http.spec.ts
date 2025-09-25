import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHttp, HttpError, createQuery } from "@marwajs/core";

declare const global: any;

beforeEach(() => {
  global.fetch = vi.fn();
});
describe("http", () => {
  it("GET with baseURL and query", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const http = createHttp({ baseURL: "https://api.test" });
    const res = await http.get<{ ok: boolean }>("/ping", {
      query: { a: 1, b: "x" },
    });
    expect(res.ok).toBe(true);

    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain("https://api.test/ping?a=1&b=x");
  });

  it("POST json and parse json", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const http = createHttp();
    const res = await http.post<{ id: number }>("/items", {
      json: { name: "A" },
    });
    expect(res.id).toBe(1);

    const [, init] = global.fetch.mock.calls[0];
    expect(init!.method).toBe("POST");
    expect((init!.headers as any)["content-type"]).toContain(
      "application/json"
    );
    expect(init!.body).toBe(JSON.stringify({ name: "A" }));
  });

  it("retries on 500", async () => {
    global.fetch
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const http = createHttp({ retry: { retries: 2, backoffMs: 0 } });
    const res = await http.get<{ ok: boolean }>("/r");
    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws HttpError on 400", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: "bad" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );

    const http = createHttp();
    await expect(http.get("/bad")).rejects.toBeInstanceOf(HttpError);
  });

  it("createQuery exposes reactive flags", async () => {
    const http = createHttp();
    const fetcher = vi.fn().mockResolvedValueOnce([{ id: 1 }]);
    const q = createQuery(fetcher);

    const p = q.refetch(); // sets loading true
    expect(q.loading()).toBe(true);
    await p;
    expect(q.loading()).toBe(false);
    //console.log(q.data());
    expect(q.data()).toBeDefined();
    expect(q.data()?.[0].id).toBe(1);
    expect(q.error()).toBe(null);
  });
});
