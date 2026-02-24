// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SelfDB",
    platforms: [
        .macOS(.v12),
        .iOS(.v15),
        .tvOS(.v15),
        .watchOS(.v8)
    ],
    products: [
        .library(
            name: "SelfDB",
            targets: ["SelfDB"]
        ),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "SelfDB",
            dependencies: [],
            path: "Sources/SelfDB"
        ),
        .testTarget(
            name: "SelfDBTests",
            dependencies: ["SelfDB"],
            path: "Tests/SelfDBTests"
        ),
    ]
)
