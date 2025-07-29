{
  "targets": [
    {
      "target_name": "cursor",
      "conditions": [
        ["OS=='win'", {
          "sources": [ "src/native/windows/cursor.cc" ]
        }],
        ["OS=='mac'", {
          "sources": [ "src/native/macos/cursor.mm" ],
          "link_settings": {
            "libraries": [
              "Foundation.framework",
              "AppKit.framework",
              "CoreGraphics.framework"
            ]
          },
          "xcode_settings": {
            "OTHER_CFLAGS": [ "-ObjC++" ]
          }
        }]
      ]
    }
  ]
}