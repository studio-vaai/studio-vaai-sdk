/** @vitest-environment jsdom */

import type {
  ApiResult,
  CallOptions,
  ExperimentsApi,
  GetTryOnDecisionArgs,
  TryOnExperimentDecision,
} from "@studio-vaai/js-client";

import { act, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StudioVaaiProvider,
  StudioVaaiProviderError,
  useStudioVaaiAvailability,
} from "../src/index.js";
import { createMockClient, testProduct } from "./helpers.js";

const defaultInput = { product: testProduct };

const ENABLED: ApiResult<TryOnExperimentDecision> = {
  ok: true,
  data: { enabled: true, variant: "enabled" },
};
const DISABLED: ApiResult<TryOnExperimentDecision> = {
  ok: true,
  data: { enabled: false, variant: "disabled" },
};

// oxlint-disable-next-line eslint-plugin-promise/avoid-new
const NEVER_RESOLVES = new Promise<never>(() => {
  /* never settles — used to keep `getTryOnDecision` pending forever */
});

function AvailabilityProbe(props: {
  timeoutMs?: number;
  attempts?: number;
  retryDelayMs?: number;
  budgetMs?: number;
}) {
  const { status } = useStudioVaaiAvailability({
    ...(props.timeoutMs === undefined ? {} : { timeoutMs: props.timeoutMs }),
    ...(props.attempts === undefined ? {} : { attempts: props.attempts }),
    ...(props.retryDelayMs === undefined ? {} : { retryDelayMs: props.retryDelayMs }),
    ...(props.budgetMs === undefined ? {} : { budgetMs: props.budgetMs }),
  });
  return <span data-testid="status">{status}</span>;
}

function MissingProviderConsumer() {
  useStudioVaaiAvailability();
  return null;
}

/** Capture the `options` argument from the first `getTryOnDecision` call. */
function deferredDecision(): {
  experiments: ExperimentsApi;
  resolve: (result: ApiResult<TryOnExperimentDecision>) => void;
  reject: (err: unknown) => void;
  getOptions: () => CallOptions | undefined;
  getCallCount: () => number;
} {
  let resolveFn!: (result: ApiResult<TryOnExperimentDecision>) => void;
  let rejectFn!: (err: unknown) => void;
  let capturedOptions: CallOptions | undefined;
  let callCount = 0;
  // oxlint-disable-next-line eslint-plugin-promise/avoid-new
  const promise = new Promise<ApiResult<TryOnExperimentDecision>>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const experiments: ExperimentsApi = {
    getTryOnDecision: async (_args: GetTryOnDecisionArgs, options?: CallOptions) => {
      callCount += 1;
      if (callCount === 1) {
        capturedOptions = options;
      }
      return await promise;
    },
  };
  return {
    experiments,
    resolve: (r) => {
      resolveFn(r);
    },
    reject: (e) => {
      rejectFn(e);
    },
    getOptions: () => capturedOptions,
    getCallCount: () => callCount,
  };
}

describe("useStudioVaaiAvailability", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("initial render is 'checking'", () => {
    const client = createMockClient({
      experiments: { getTryOnDecision: async () => await NEVER_RESOLVES },
    });
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe />
      </StudioVaaiProvider>,
    );
    expect(getByTestId("status").textContent).toBe("checking");
  });

  it("returns 'available' on { enabled: true }", async () => {
    const client = createMockClient({
      experiments: {
        getTryOnDecision: vi.fn<ExperimentsApi["getTryOnDecision"]>().mockResolvedValue(ENABLED),
      },
    });
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe />
      </StudioVaaiProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("available");
    });
  });

  it("returns 'unavailable' on { enabled: false } (holdback arm)", async () => {
    const client = createMockClient({
      experiments: {
        getTryOnDecision: vi.fn<ExperimentsApi["getTryOnDecision"]>().mockResolvedValue(DISABLED),
      },
    });
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe />
      </StudioVaaiProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("unavailable");
    });
  });

  it("returns 'unavailable' on { ok: false } once the attempts are spent (fails closed)", async () => {
    const client = createMockClient({
      experiments: {
        getTryOnDecision: vi
          .fn<ExperimentsApi["getTryOnDecision"]>()
          .mockResolvedValue({ ok: false, error: { kind: "internal_server_error", message: "x" } }),
      },
    });
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe attempts={1} />
      </StudioVaaiProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("unavailable");
    });
  });

  it("returns 'unavailable' when getTryOnDecision throws on every attempt", async () => {
    const client = createMockClient({
      experiments: {
        getTryOnDecision: vi
          .fn<ExperimentsApi["getTryOnDecision"]>()
          .mockRejectedValue(new Error("network down")),
      },
    });
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe attempts={1} />
      </StudioVaaiProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("unavailable");
    });
  });

  it("returns 'unavailable' on timeout and aborts the in-flight request", async () => {
    vi.useFakeTimers();
    const deferred = deferredDecision();
    const client = createMockClient({ experiments: deferred.experiments });
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe timeoutMs={2500} attempts={1} />
      </StudioVaaiProvider>,
    );
    expect(getByTestId("status").textContent).toBe("checking");

    await act(async () => {
      vi.advanceTimersByTime(2499);
    });
    expect(getByTestId("status").textContent).toBe("checking");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(getByTestId("status").textContent).toBe("unavailable");
    expect(deferred.getOptions()?.signal?.aborted).toBe(true);
  });

  it("aborts the in-flight request on unmount and ignores a late resolution", async () => {
    const deferred = deferredDecision();
    const client = createMockClient({ experiments: deferred.experiments });
    const { unmount, getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe />
      </StudioVaaiProvider>,
    );
    expect(getByTestId("status").textContent).toBe("checking");

    const signal = deferred.getOptions()?.signal;
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);

    unmount();
    expect(signal?.aborted).toBe(true);

    // Resolving after unmount must not throw / warn — assert by awaiting microtasks.
    deferred.resolve(ENABLED);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("recovers when an early attempt fails and a later one answers", async () => {
    // The point of retrying: one blip must not hide the entry point for the whole page view.
    const getTryOnDecision = vi
      .fn<ExperimentsApi["getTryOnDecision"]>()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: false, error: { kind: "internal_server_error", message: "x" } })
      .mockResolvedValue(ENABLED);
    const client = createMockClient({ experiments: { getTryOnDecision } });
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe attempts={3} retryDelayMs={1} />
      </StudioVaaiProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("available");
    });
    expect(getTryOnDecision.mock.calls.length).toBe(3);
  });

  it("does not retry a holdback decision the server actually returned", async () => {
    // `disabled` is an ANSWER, not a failure — retrying it would both waste requests and
    // risk flipping a holdback visitor to `available` on a later, different bucketing.
    const getTryOnDecision = vi
      .fn<ExperimentsApi["getTryOnDecision"]>()
      .mockResolvedValue(DISABLED);
    const client = createMockClient({ experiments: { getTryOnDecision } });
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe attempts={3} retryDelayMs={1} />
      </StudioVaaiProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("unavailable");
    });
    expect(getTryOnDecision.mock.calls.length).toBe(1);
  });

  it("settles at the deadline even when the transport ignores the abort signal", async () => {
    // A client that never rejects on abort would otherwise leave the probe awaiting forever
    // and the entry point stuck in `checking` — the deadline is raced, not merely wired to
    // the signal.
    vi.useFakeTimers();
    const client = createMockClient({
      experiments: { getTryOnDecision: async () => await NEVER_RESOLVES },
    });
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe timeoutMs={100} attempts={2} retryDelayMs={10} />
      </StudioVaaiProvider>,
    );
    expect(getByTestId("status").textContent).toBe("checking");

    // First attempt's deadline, the backoff, then the second attempt's deadline.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100 + 10 + 100);
    });
    expect(getByTestId("status").textContent).toBe("unavailable");
  });

  it("keeps a granted CTA when a later probe fails", async () => {
    // The effect re-runs when the session resolves, to upgrade a bucketed visitor. If that
    // re-probe hits a blip it must not retract a button the visitor is already looking at —
    // an unreachable backend says nothing new about the rollout.
    const getTryOnDecision = vi
      .fn<ExperimentsApi["getTryOnDecision"]>()
      .mockResolvedValueOnce(ENABLED)
      .mockRejectedValue(new Error("network down"));
    const client = createMockClient({ experiments: { getTryOnDecision } });
    const { getByTestId, rerender } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe attempts={1} retryDelayMs={1} />
      </StudioVaaiProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("available");
    });

    // Force the effect to run again with a now-failing transport.
    rerender(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe attempts={1} retryDelayMs={2} />
      </StudioVaaiProvider>,
    );
    await waitFor(() => {
      expect(getTryOnDecision.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(getByTestId("status").textContent).toBe("available");
  });

  it("stops retrying once the budget is spent", async () => {
    // `checking` renders no entry point, so retrying must not stretch how long the CTA is
    // missing: the budget caps the whole probe well below attempts x timeout.
    vi.useFakeTimers();
    const getTryOnDecision = vi
      .fn<ExperimentsApi["getTryOnDecision"]>()
      .mockImplementation(async () => await NEVER_RESOLVES);
    const client = createMockClient({ experiments: { getTryOnDecision } });
    const { getByTestId } = render(
      <StudioVaaiProvider client={client} input={defaultInput}>
        <AvailabilityProbe timeoutMs={100} attempts={99} retryDelayMs={10} budgetMs={250} />
      </StudioVaaiProvider>,
    );
    // Advanced in steps, not one jump: each attempt is a separate await, so the loop only
    // progresses when microtasks get a chance to flush between timer batches.
    for (const _ of [0, 1, 2, 3]) {
      // oxlint-disable-next-line no-await-in-loop -- the point is to interleave the ticks
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    // Unbounded, 99 attempts would still be running; the 250ms budget stopped it after three.
    expect(getByTestId("status").textContent).toBe("unavailable");
    expect(getTryOnDecision.mock.calls.length).toBe(3);
  });

  it("throws StudioVaaiProviderError when used outside a provider", () => {
    expect(() => render(<MissingProviderConsumer />)).toThrow(StudioVaaiProviderError);
  });

  it("issues a fresh request on remount under StrictMode", async () => {
    const getTryOnDecision = vi.fn<ExperimentsApi["getTryOnDecision"]>().mockResolvedValue(ENABLED);
    const client = createMockClient({ experiments: { getTryOnDecision } });
    const { getByTestId } = render(
      <StrictMode>
        <StudioVaaiProvider client={client} input={defaultInput}>
          <AvailabilityProbe />
        </StudioVaaiProvider>
      </StrictMode>,
    );
    await waitFor(() => {
      expect(getByTestId("status").textContent).toBe("available");
    });
    // Strict mode double-invokes effects in development; both calls fire and the
    // second one is the one whose state survives.
    expect(getTryOnDecision.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
