#!/bin/bash
# Requires Xcode and xcodegen. All generated state stays outside the checkout.
set -euo pipefail
source_dir=$(cd "$(dirname "$0")" && pwd)
build_dir=${1:-/private/tmp/storybook-delivery-xcode}
mkdir -p "$build_dir"
cat > "$build_dir/project.yml" <<YAML
name: StoryDeliveryHarness
options:
  bundleIdPrefix: test.story
settings:
  SWIFT_VERSION: "5.0"
  CODE_SIGN_IDENTITY: "-"
  CODE_SIGNING_REQUIRED: "NO"
targets:
  StoryDeliveryHarness:
    type: application
    platform: iOS
    deploymentTarget: "16.4"
    sources:
      - path: "$source_dir/TransportHarness.swift"
      - path: "$source_dir/../ios/NativeTransfers.swift"
      - path: "$source_dir/../ios/SharedPlayback.swift"
    settings:
      PRODUCT_BUNDLE_IDENTIFIER: test.story.delivery.reliability
      TARGETED_DEVICE_FAMILY: "1,2"
    info:
      path: "$build_dir/Info.plist"
      properties:
        UILaunchScreen: {}
        NSAppTransportSecurity:
          NSAllowsArbitraryLoads: true
YAML
xcodegen generate --spec "$build_dir/project.yml" --project "$build_dir"
xcodebuild -project "$build_dir/StoryDeliveryHarness.xcodeproj" -scheme StoryDeliveryHarness -sdk iphonesimulator -configuration Debug -derivedDataPath "$build_dir/derived" CODE_SIGN_IDENTITY=- build
