"use client";
import { useEffect } from "react";
import { useScenaro } from "./ScenaroProvider";
import type { CollectionItemContext } from "../core/collection-item-context";
/** Explicit display tracking: fetched results are available, not automatically seen. */
export function useCollectionItemContext(
  context: CollectionItemContext | null,
) {
  const { session } = useScenaro();
  useEffect(() => {
    if (context) void session.updateCollectionItemContext(context);
  }, [session, context]);
}
