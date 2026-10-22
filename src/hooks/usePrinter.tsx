"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import { validateCommand, type PrinterCommand, type ValidationResult } from "@/printer/commands";
import { createPrinterProvider, type ProviderConfig } from "@/printer/providers/provider-factory";
import { PrinterRuntime, type RuntimeSnapshot } from "@/printer/runtime";

interface RuntimeBinding {
  runtime: PrinterRuntime;
  store: StoreApi<RuntimeSnapshot>;
}

const RuntimeContext = createContext<RuntimeBinding | null>(null);

const subscribeNever = () => () => {};

/** True only after hydration, without a setState-in-effect round trip. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * Owns one printer runtime per provider config. Construction has no side effects; connecting
 * (timers, sockets) happens in an effect and is undone on cleanup, so React Strict Mode's
 * mount/unmount/mount cycle is safe. Nothing renders on the server: the display is client-only.
 */
export function PrinterRuntimeProvider({
  config,
  fallback = null,
  children,
}: {
  config: ProviderConfig;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const isClient = useIsClient();
  const configKey = JSON.stringify(config);

  const binding = useMemo<RuntimeBinding>(() => {
    const runtime = new PrinterRuntime(
      createPrinterProvider(JSON.parse(configKey) as ProviderConfig),
    );
    const store = createStore<RuntimeSnapshot>(() => runtime.getSnapshot());
    runtime.subscribe((snapshot) => store.setState(snapshot, true));
    return { runtime, store };
  }, [configKey]);

  useEffect(() => {
    void binding.runtime.start();
    return () => void binding.runtime.stop();
  }, [binding]);

  if (!isClient) return <>{fallback}</>;
  return <RuntimeContext.Provider value={binding}>{children}</RuntimeContext.Provider>;
}

function useBinding(): RuntimeBinding {
  const binding = useContext(RuntimeContext);
  if (!binding) throw new Error("usePrinter* hooks must be used inside <PrinterRuntimeProvider>");
  return binding;
}

/** Subscribe to a slice of the runtime snapshot; re-renders only when the slice changes. */
export function usePrinter<T>(selector: (snapshot: RuntimeSnapshot) => T): T {
  return useStore(useBinding().store, selector);
}

export function useRuntime(): PrinterRuntime {
  return useBinding().runtime;
}

/** Validation for a command, re-evaluated whenever printer state or time changes. */
export function useCommandValidation(command: PrinterCommand, now: number): ValidationResult {
  const runtime = useRuntime();
  const state = usePrinter((s) => s.state);
  return validateCommand(command, state, {
    supported: runtime.provider.capabilities.commands,
    now,
    staleAfterMs: runtime.staleAfterMs,
  });
}
