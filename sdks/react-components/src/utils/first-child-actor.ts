import type { AnyActorRef } from "xstate";

/** First invoked child actor (e.g. session intro) for routing events to nested machines. */
export function firstChildActor(actor: AnyActorRef): AnyActorRef | undefined {
  const snap = actor.getSnapshot() as {
    children: Map<string, AnyActorRef> | Record<string, AnyActorRef>;
  };
  const raw = snap.children;
  if (raw instanceof Map) {
    return [...raw.values()].find((child) => child.id !== "sessionRetention");
  }
  const values = Object.values(raw ?? {});
  return values.find((child) => child.id !== "sessionRetention");
}
