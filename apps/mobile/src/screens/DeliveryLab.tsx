import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import {
  catalog,
  manifest,
  delivery,
  useDeliveryLabProxy,
} from "../delivery/client";
import {
  downloads,
  sharedPlayback,
  sharedPlaybackEnabled,
} from "../delivery/native";
import NativeStorage from "../../modules/story-storage";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function DeliveryLab() {
  const sharedController = useRef<AbortController | null>(null);
  const [report, setReport] = useState<string[]>([]),
    [running, setRunning] = useState(false);
  const log = (line: string) => {
    setReport((r) => [...r, line]);
    console.log("[DeliveryLab] " + line);
    const proxy = process.env.EXPO_PUBLIC_DELIVERY_LAB_PROXY;
    if (__DEV__ && proxy)
      void fetch(proxy + "/report", { method: "POST", body: line }).catch(
        () => {},
      );
  };
  useEffect(() => {
    if (__DEV__ && process.env.EXPO_PUBLIC_DELIVERY_LAB_AUTORUN === "shared")
      void sharedLab();
    return () => sharedController.current?.abort();
  }, []);
  async function sharedLab() {
    sharedController.current?.abort();
    const controller = new AbortController();
    sharedController.current = controller;
    const check = () => {
      if (controller.signal.aborted) throw new Error("Lab restarted");
    };
    setRunning(true);
    setReport([]);
    const player = createAudioPlayer(null, {
      downloadFirst: false,
      updateInterval: 100,
    });
    try {
      if (!sharedPlaybackEnabled)
        throw new Error(
          "Enable EXPO_PUBLIC_SHARED_AUDIO_CACHE=1 in this development build",
        );
      const proxy = process.env.EXPO_PUBLIC_DELIVERY_LAB_PROXY;
      if (!proxy) throw new Error("Configure the local lab proxy");
      const entry = (await catalog()).find((e) => e.visibility === "available");
      if (!entry) throw new Error("Publish a lab book first");
      const m = await manifest(Object.values(entry.releases)[0]);
      const clip = Object.values(m.audio).sort(
        (a, b) => b.duration - a.duration,
      )[0];
      const q = await downloads();
      check();
      q.stop();
      // Reset only this development asset; never label an old cache hit as progressive reuse.
      await NativeStorage.pause(clip.id);
      await NativeStorage.forget(clip.id);
      const FS = await import("expo-file-system/legacy");
      const root = await NativeStorage.root();
      await FS.deleteAsync(root + clip.id + ".mp3", { idempotent: true });
      await FS.deleteAsync(root + clip.id + ".partial", { idempotent: true });
      if (q.state.transfers[clip.id]) {
        q.state.transfers[clip.id].state = "queued";
        delete q.state.transfers[clip.id].local;
      }
      useDeliveryLabProxy();
      q.policy(false);
      await fetch(proxy + "/reset");
      check();
      q.select(m, undefined, [clip.id]);
      const uri = await sharedPlayback(clip, m),
        started = Date.now();
      await setAudioModeAsync({ playsInSilentMode: true });
      player.replace({ uri });
      player.play();
      for (
        let i = 0;
        i < 300 && player.currentTime < 0.1 && !controller.signal.aborted;
        i++
      )
        await delay(100);
      check();
      const first = await (await fetch(proxy + "/stats")).json();
      const firstBytes = first.perAsset["/media/" + clip.id] ?? 0;
      const nativeState = await NativeStorage.status(clip.id);
      log(
        `Native transfer: ${nativeState.state}; bytes=${nativeState.bytesWritten}`,
      );
      if (player.currentTime < 0.1 || firstBytes >= clip.bytes)
        throw new Error(
          `Progressive reuse not proved: position=${player.currentTime}, bytes=${firstBytes}/${clip.bytes}`,
        );
      log(
        `Shared progressive start ${Date.now() - started} ms; ${firstBytes}/${clip.bytes} origin bytes; loopback source`,
      );
      player.pause();
      const paused = player.currentTime;
      await delay(500);
      if (Math.abs(player.currentTime - paused) > 0.3)
        throw new Error("Pause moved");
      // Finishing the durable download while playback is paused must not start a second writer.
      for (
        let i = 0;
        i < 1500 && !(await q.local(clip)) && !controller.signal.aborted;
        i++
      ) {
        await q.pump();
        await delay(100);
      }
      check();
      const local = await q.local(clip);
      if (!local) throw new Error("Shared transfer did not verify");
      const complete = await (await fetch(proxy + "/stats")).json(),
        bytes = complete.perAsset["/media/" + clip.id] ?? 0;
      if (bytes !== clip.bytes)
        throw new Error(`Duplicate origin bytes: ${bytes}/${clip.bytes}`);
      log(`PASS shared bytes: ${bytes}/${clip.bytes}; full checksum verified`);
      player.replace({ uri: local });
      player.play();
      for (let i = 0; i < 100 && player.currentTime < 0.1; i++)
        await delay(100);
      if (player.currentTime < 0.1)
        throw new Error("Verified local playback did not advance");
      await player.seekTo(Math.min(120, clip.duration - 10));
      await delay(1000);
      if (player.currentTime < Math.min(120, clip.duration - 10))
        throw new Error("Local seek failed");
      log(
        `PASS verified local playback and seek: ${player.currentTime.toFixed(2)} seconds`,
      );
      await q.flush();
      q.stop();
      log(
        "PASS shared lab. Physical lifecycle, slow seek-ahead and voice acceptance remain separate.",
      );
    } catch (e) {
      if (!controller.signal.aborted) log("FAIL: " + String(e));
    } finally {
      player.remove();
      setRunning(false);
    }
  }
  async function run() {
    setRunning(true);
    setReport([]);
    const player = createAudioPlayer(null, {
      downloadFirst: false,
      updateInterval: 100,
    });
    try {
      await setAudioModeAsync({ playsInSilentMode: true });
      const entries = await catalog(),
        entry = entries.find((e) => e.visibility === "available");
      if (!entry) throw new Error("Publish a book first");
      const m = await manifest(Object.values(entry.releases)[0]),
        clip = Object.values(m.audio).sort(
          (a, b) => b.duration - a.duration,
        )[0];
      const ticket = await delivery(m, clip.id);
      const proxy = process.env.EXPO_PUBLIC_DELIVERY_LAB_PROXY;
      if (!proxy)
        throw new Error("Set EXPO_PUBLIC_DELIVERY_LAB_PROXY for the local lab");
      const url = new URL(ticket.url);
      url.host = new URL(proxy).host;
      url.protocol = new URL(proxy).protocol;
      await fetch(proxy + "/reset");
      const started = Date.now();
      player.replace({ uri: url.toString() });
      player.play();
      for (let i = 0; i < 200 && player.currentTime < 0.1; i++)
        await delay(100);
      if (player.currentTime < 0.1)
        throw new Error("No playback progress within 20 seconds");
      const stats = await (await fetch(proxy + "/stats")).json();
      log(
        `Progressive start ${Date.now() - started} ms; proxy sent ${stats.bytesSent}/${clip.bytes} bytes; duration ${clip.duration.toFixed(2)}s`,
      );
      if (stats.bytesSent >= clip.bytes)
        throw new Error("Progressive start was not proved");
      await player.seekTo(Math.min(120, clip.duration - 10));
      await delay(2000);
      log(`Seek position: ${player.currentTime.toFixed(2)}s`);
      player.pause();
      const paused = player.currentTime;
      await delay(500);
      log(`Pause stable: ${Math.abs(player.currentTime - paused) < 0.3}`);
      player.play();
      await delay(1000);
      player.pause();
      const q = await downloads();
      q.stop();
      q.policy(true);
      q.add(m, true);
      for (let i = 0; i < 600 && !q.complete(m.releaseId); i++) {
        await q.pump();
        await delay(100);
      }
      if (!q.complete(m.releaseId))
        throw new Error("Offline package not complete");
      await q.reconcile();
      log(
        `Verified full package after reconciliation: ${q.complete(m.releaseId)}`,
      );
      await playLocalChoices(m, player, q);
      await q.flush();
      log(
        "PASS. Physical-device suspension/force-quit and Android remain separate checks.",
      );
    } catch (e) {
      log("FAIL: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      player.remove();
      setRunning(false);
    }
  }
  async function playLocalChoices(
    m: Awaited<ReturnType<typeof manifest>>,
    player: ReturnType<typeof createAudioPlayer>,
    q: Awaited<ReturnType<typeof downloads>>,
  ) {
    for (const node of Object.values(m.story.nodes)) {
      if (node.kind !== "choice") continue;
      for (const option of node.options) {
        const asset = m.audio[option.responseSegments[0].id],
          local = await q.local(asset);
        if (!local) throw new Error("Missing option");
        player.replace({ uri: local });
        for (let i = 0; i < 50 && !player.isLoaded; i++) await delay(100);
        player.play();
        for (let i = 0; i < 50 && player.currentTime < 0.1; i++)
          await delay(100);
        log(
          `Local option ${option.id}: ${player.currentTime.toFixed(2)}s from file URL`,
        );
        if (player.currentTime < 0.1)
          throw new Error(
            `Local playback failed: ${JSON.stringify(player.currentStatus)}`,
          );
        player.pause();
      }
    }
  }
  async function offlineLab() {
    setRunning(true);
    setReport([]);
    const player = createAudioPlayer(null, {
      downloadFirst: false,
      updateInterval: 100,
    });
    try {
      const entry = (await catalog(false)).find(
        (e) => e.visibility === "available",
      );
      if (!entry) throw new Error("No cached lab book");
      const m = await manifest(Object.values(entry.releases)[0]);
      const q = await downloads();
      await q.reconcile();
      if (!q.complete(m.releaseId))
        throw new Error("Book is not completely downloaded");
      await setAudioModeAsync({ playsInSilentMode: true });
      await playLocalChoices(m, player, q);
      log(
        "PASS: complete package and both local responses after restart; no delivery URLs requested.",
      );
    } catch (e) {
      log("FAIL: " + String(e));
    } finally {
      player.remove();
      setRunning(false);
    }
  }
  async function backgroundLab() {
    setRunning(true);
    setReport([]);
    try {
      const entry = (await catalog()).find((e) => e.visibility === "available");
      if (!entry) throw new Error("Publish a lab book first");
      const m = await manifest(Object.values(entry.releases)[0]);
      const clip = Object.values(m.audio).sort(
        (a, b) => b.duration - a.duration,
      )[0];
      const proxy = process.env.EXPO_PUBLIC_DELIVERY_LAB_PROXY;
      if (!proxy) throw new Error("Configure the local delivery lab proxy");
      const q = await downloads();
      q.stop();
      await q.remove(m.releaseId);
      await q.flush();
      useDeliveryLabProxy();
      q.policy(true);
      q.add(m, true);
      await q.flush();
      await q.pump();
      log(
        `Native background task enqueued: ${clip.id}; ${clip.bytes} bytes. Background the app; inspect native completion before relaunch. This resets this development book's download.`,
      );
    } catch (e) {
      log("FAIL: " + String(e));
    } finally {
      setRunning(false);
    }
  }
  return (
    <View style={{ marginTop: 64 }}>
      <Pressable disabled={running} onPress={sharedLab}>
        <Text style={{ padding: 12, color: "#695091" }}>
          Development: verify shared playback bytes
        </Text>
      </Pressable>
      <Pressable disabled={running} onPress={run}>
        <Text style={{ padding: 12, color: "#695091" }}>
          Development: run delivery lab
        </Text>
      </Pressable>
      <Pressable disabled={running} onPress={backgroundLab}>
        <Text style={{ padding: 12, color: "#695091" }}>
          Development: reset lab book and test background download
        </Text>
      </Pressable>
      <Pressable disabled={running} onPress={offlineLab}>
        <Text style={{ padding: 12, color: "#695091" }}>
          Development: validate offline responses
        </Text>
      </Pressable>
      {report.map((line, i) => (
        <Text key={i} selectable style={{ padding: 4 }}>
          {line}
        </Text>
      ))}
    </View>
  );
}
