import ExpoModulesCore
import Network

public class StoryStorageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StoryStorage")
    AsyncFunction("enqueue") { (json: String, promise: Promise) in
      NativeTransfers.shared.enqueue(json) { error in
        if let error {
          promise.reject("TRANSFER", error.localizedDescription)
        } else {
          promise.resolve(nil)
        }
      }
    }
    AsyncFunction("playbackUrl") { (id: String) -> String in
      guard id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
        throw NSError(domain: "StoryTransfer", code: 1)
      }
      return SharedPlayback.shared.url(id)
    }
    AsyncFunction("transferStatus") { (id: String) -> [String: Any] in
      NativeTransfers.shared.status(id)
    }
    AsyncFunction("pauseTransfer") { (id: String, promise: Promise) in
      NativeTransfers.shared.pause(id) { promise.resolve(nil) }
    }
    AsyncFunction("retainTransfers") { (ids: [String]) in NativeTransfers.shared.retain(ids) }
    AsyncFunction("forgetTransfer") { (id: String) in NativeTransfers.shared.forget(id) }
    AsyncFunction("root") { () -> String in
      var url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("StoryMedia", isDirectory: true)
      try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      return url.absoluteString + "/"
    }
    AsyncFunction("unconstrainedWifi") { (promise: Promise) in
      let monitor = NWPathMonitor()
      monitor.pathUpdateHandler = { path in
        monitor.cancel()
        promise.resolve(
          path.status == .satisfied && path.usesInterfaceType(.wifi) && !path.isExpensive
            && !path.isConstrained)
      }
      monitor.start(queue: DispatchQueue(label: "story.network"))
    }
  }
}

public class StoryTransferSubscriber: ExpoAppDelegateSubscriber {
  public func applicationDidEnterBackground(_ application: UIApplication) {
    NativeTransfers.shared.handoffToBackground()
  }
  public func application(
    _ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    if identifier == "com.masalyolu.story-transfers.v1" {
      NativeTransfers.shared.backgroundCompletion = completionHandler
    }
  }
}
