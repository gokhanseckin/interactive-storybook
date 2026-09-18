import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import {
  catalog,
  manifest,
  delivery,
  useDeliveryLabProxy,
} from "../delivery/client";
import { downloads } from "../delivery/native";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function DeliveryLab() {
  const [report, setReport] = useState<string[]>([]),
    [running, setRunning] = useState(false);
  const log = (line: string) => {
    setReport((r) => [...r, line]);
    console.log("[DeliveryLab] " + line);
  };
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
    <View style={{ marginTop: 24 }}>
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
