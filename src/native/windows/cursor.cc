#ifdef _WIN32
#include <node.h>
#include <windows.h>

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
  HWND hwnd = (HWND)static_cast<int64_t>(args[0].As<Number>()->Value());

  // Set the window to be hidden from screen capture
  SetWindowDisplayAffinity(hwnd, WDA_MONITOR);
}

// Hide and lock the cursor to a specific position
void HideAndLockCursor(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  // Get the x and y coordinates from the arguments
  double x = args[0].As<Number>()->Value();
  double y = args[1].As<Number>()->Value();

  // Hide the cursor
  ShowCursor(FALSE);

  // Create a 1x1 rectangle to restrict the cursor
  RECT rect;
  rect.left = static_cast<LONG>(x);
  rect.top = static_cast<LONG>(y);
  rect.right = rect.left + 1;
  rect.bottom = rect.top + 1;

  // Lock the cursor to the rectangle
  ClipCursor(&rect);

  // Move the cursor to the position
  SetCursorPos(static_cast<int>(x), static_cast<int>(y));
}

// Restore the cursor
void RestoreCursor(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  // Show the cursor
  ShowCursor(TRUE);

  // Unlock the cursor
  ClipCursor(NULL);
}

void Initialize(Local<Object> exports) {
  NODE_SET_METHOD(exports, "setWindowHiddenFromCapture", SetWindowHiddenFromCapture);
  NODE_SET_METHOD(exports, "hideAndLockCursor", HideAndLockCursor);
  NODE_SET_METHOD(exports, "restoreCursor", RestoreCursor);
}

NODE_MODULE(NODE_GYP_MODULE_NAME, Initialize)

}  // namespace cursor
#endif