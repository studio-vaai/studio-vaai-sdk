import { BackendError, Outcome } from "@studio-vaai/core";
import { ApiClient, browserTransport } from "@studio-vaai/core/api";
import { beforeAll, describe, expect, it } from "vitest";

import { processPhoto } from "../../src/experience/api/photo.js";
import { initializeTestUi } from "../ui-fixture.js";
import { jpeg } from "./helpers/image-fixtures.js";

describe("staged photo upload", () => {
  beforeAll(initializeTestUi);

  it.each([
    {
      endpoint: "/bodies/upload-urls",
      outcome: new Outcome.Failed({ error: BackendError.Unavailable }),
    },
    { endpoint: "/bodies", outcome: new Outcome.Unknown() },
  ])(
    "classifies a transport deadline on $endpoint at the write boundary",
    async ({ endpoint, outcome }) => {
      const deadline = new AbortController();
      const requestStarted = Promise.withResolvers<boolean>();
      const routes: string[] = [];
      const photo = jpeg(100, 100);
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        routes.push(path);
        if (path === endpoint) {
          if (path === "/bodies") {
            await expect(request.json()).resolves.toMatchObject({
              stagingKey: "test",
              imageMetadata: { originalWidth: 100, originalHeight: 100 },
            });
          }
          requestStarted.resolve(true);
          // oxlint-disable-next-line eslint-plugin-promise/avoid-new -- The mock holds the response until fetch is aborted.
          return await new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener(
              "abort",
              () => {
                reject(new Error("The request was aborted."));
              },
              { once: true },
            );
          });
        }
        if (path === "/upload") {
          expect(request.method).toBe("PUT");
          const uploaded = await request.arrayBuffer();
          expect(uploaded.byteLength).toBe(photo.size);
          return new Response(null);
        }
        if (path === "/bodies/upload-urls") {
          return Response.json({
            uploadUrl: "https://storage.example.test/upload",
            method: "PUT",
            stagingKey: "test",
            requiredHeaders: [{ name: "Content-Type", value: "image/jpeg" }],
            expiresAt: "2099-01-01T00:00:00Z",
          });
        }
        throw new Error(`Unexpected upload request ${path}`);
      };
      const client = new ApiClient(
        { baseUrl: "https://api.example.test", clientApiKey: "sv_client_test" },
        browserTransport(fetch, false, deadline.signal),
      );
      const pending = processPhoto(client, () => 0n, fetch, photo, deadline.signal);
      try {
        await expect(Promise.race([requestStarted.promise, pending])).resolves.toBe(true);
        deadline.abort(new DOMException("Deadline reached", "TimeoutError"));
        await expect(pending).resolves.toEqual(outcome);
        expect(routes).toEqual(
          endpoint === "/bodies" ? ["/bodies/upload-urls", "/upload", "/bodies"] : [endpoint],
        );
      } finally {
        deadline.abort();
        await Promise.allSettled([pending]);
        client.uniffiDestroy();
      }
    },
  );
});
