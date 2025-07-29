#ifdef __APPLE__
#include <node.h>
#include <Foundation/Foundation.h>
#include <AppKit/AppKit.h>
#include <CoreGraphics/CoreGraphics.h>

namespace cursor {

using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::Value;
using v8::Number;

// Set window to be hidden from screen capture
void SetWindowHiddenFromCapture(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  // Get the window handle from the first argument
  NSUInteger windowID = static_cast<NSUInteger>(args[0].As<Number>()->Value());

  // Find the NSWindow with the given ID
  NSWindow* window = [NSApp windowWithWindowNumber: windowID];

  if (window) {
    // Set the window to be hidden from screen capture
    [window setSharingType: NSWindowSharingNone];
  }
}

// Hide and lock the cursor to a specific position
void HideAndLockCursor(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  // Get the x and y coordinates from the arguments
  double x = args[0].As<Number>()->Value();
  double y = args[1].As<Number>()->Value();

  // Hide the cursor
  CGDisplayHideCursor(kCGDirectMainDisplay);

  // Disable the connection between mouse and cursor movement
  CGAssociateMouseAndMouseCursorPosition(false);

  // Move the cursor to the position
  CGPoint point = CGPointMake(x, y);
  CGWarpMouseCursorPosition(point);
}

// Restore the cursor
void RestoreCursor(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  // Show the cursor
  CGDisplayShowCursor(kCGDirectMainDisplay);

  // Re-enable the connection between mouse and cursor movement
  CGAssociateMouseAndMouseCursorPosition(true);
}

void Initialize(Local<Object> exports) {
  NODE_SET_METHOD(exports, "setWindowHiddenFromCapture", SetWindowHiddenFromCapture);
  NODE_SET_METHOD(exports, "hideAndLockCursor", HideAndLockCursor);
  NODE_SET_METHOD(exports, "restoreCursor", RestoreCursor);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, Initialize)

}  // namespace cursor
#endif