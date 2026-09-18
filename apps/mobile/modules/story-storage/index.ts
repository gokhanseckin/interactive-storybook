import { requireOptionalNativeModule } from "expo-modules-core";
export type TransferSpec = {
  id: string;
  bytes: number;
  extension: "mp3" | "png" | "jpg";
  url: string;
  wifiOnly: boolean;
  urgent: boolean;
};
type Native = {
  root(): Promise<string>;
  unconstrainedWifi(): Promise<boolean>;
  enqueue(json: string): Promise<void>;
  transferStatus(id: string): Promise<{
    state: string;
    bytesWritten?: number;
    uri?: string;
    error?: string;
  }>;
  pauseTransfer(id: string): Promise<void>;
  forgetTransfer(id: string): Promise<void>;
  retainTransfers(ids: string[]): Promise<void>;
};
const native = requireOptionalNativeModule<Native>("StoryStorage");
function module(): Native {
  if (!native)
    throw new Error(
      "Offline downloads require a new native development build.",
    );
  return native;
}
export default {
  root: () => module().root(),
  unconstrainedWifi: () =>
    native ? native.unconstrainedWifi() : Promise.resolve(false),
  enqueue: (spec: TransferSpec) => module().enqueue(JSON.stringify(spec)),
  status: (id: string) => module().transferStatus(id),
  pause: (id: string) => module().pauseTransfer(id),
  forget: (id: string) => module().forgetTransfer(id),
  retain: (ids: string[]) => module().retainTransfers(ids),
};
