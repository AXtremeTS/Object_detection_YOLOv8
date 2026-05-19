"""
YOLOv8s UI Backend
Communicates with Electron via stdin/stdout JSON messages.
Protocol:
  - Reads JSON lines from stdin
  - Writes JSON lines to stdout
"""
import sys
import json
import base64
import threading
import cv2
import numpy as np
from collections import Counter
from ultralytics import YOLO

# ── Colour palette (BGR) ──────────────────────────────────────────────────────
COLORS_BGR = [
    (56,  139, 253), (255,  99,  71), ( 50, 205,  50), (255, 165,   0),
    (147, 112, 219), (  0, 206, 209), (255,  20, 147), (100, 149, 237),
    (154, 205,  50), (255, 215,   0), (127, 255,   0), (  0, 191, 255),
    (255, 127,  80), (  0, 250, 154), (218, 112, 214), (255, 160, 122),
]
COLORS_HEX = [
    "#388bfd", "#ff6347", "#32cd32", "#ffa500",
    "#9370db", "#00cecd", "#ff1493", "#6495ed",
    "#9acd32", "#ffd700", "#7fff00", "#00bfff",
    "#ff7f50", "#00fa9a", "#da70d6", "#ffa07a",
]

DET_MODEL_PATH = "yolov8s.pt"
SEG_MODEL_PATH = "yolov8s-seg.pt"   # auto-downloaded on first use

_det_model  = None   # detection model
_seg_model  = None   # segmentation model
_cap        = None
_stop_flag  = False
_pause_flag = False
_seek_pos   = None
_draw_mode  = "box"  # "box" | "draw" — hot-swappable
_conf       = 0.25   # confidence threshold — hot-swappable
_hidden_labels = set()  # label names to skip drawing — hot-swappable


# ── Model loaders ─────────────────────────────────────────────────────────────
def get_det_model():
    global _det_model
    if _det_model is None:
        _det_model = YOLO(DET_MODEL_PATH)
    return _det_model


def get_seg_model():
    global _seg_model
    if _seg_model is None:
        _seg_model = YOLO(SEG_MODEL_PATH)   # downloads ~25 MB on first run
    return _seg_model


def color_for(class_id: int):
    return COLORS_BGR[class_id % len(COLORS_BGR)], COLORS_HEX[class_id % len(COLORS_HEX)]


# ── Box mode annotation ───────────────────────────────────────────────────────
def draw_boxes(frame: np.ndarray, boxes, labels, scores, class_ids, hidden=None) -> np.ndarray:
    hidden = hidden or set()
    img = frame.copy()
    for (x1, y1, x2, y2), label, score, cls_id in zip(boxes, labels, scores, class_ids):
        if label in hidden:
            continue
        bgr, _ = color_for(cls_id)
        text = f"{label} {score:.2f}"
        cv2.rectangle(img, (x1, y1), (x2, y2), bgr, 2)
        (tw, th), bl = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        ly = max(y1 - 4, th + bl)
        cv2.rectangle(img, (x1, ly - th - bl), (x1 + tw + 4, ly + bl - 2), bgr, -1)
        cv2.putText(img, text, (x1 + 2, ly - 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
    return img


# ── Draw (mask) mode annotation ───────────────────────────────────────────────
def draw_masks(frame: np.ndarray, masks, labels, scores, class_ids, hidden=None) -> np.ndarray:
    hidden = hidden or set()
    img = frame.copy()
    overlay = img.copy()

    for mask, label, score, cls_id in zip(masks, labels, scores, class_ids):
        if label in hidden:
            continue
        bgr, _ = color_for(cls_id)
        mask_bin = (mask > 0.5).astype(np.uint8)
        contours, _ = cv2.findContours(mask_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(overlay, contours, -1, bgr, thickness=cv2.FILLED)
        cv2.drawContours(img, contours, -1, bgr, thickness=2)
        if contours:
            largest = max(contours, key=cv2.contourArea)
            x, y, w, h = cv2.boundingRect(largest)
            text = f"{label} {score:.2f}"
            (tw, th), bl = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
            ly = max(y - 4, th + bl)
            cv2.rectangle(img, (x, ly - th - bl), (x + tw + 4, ly + bl - 2), bgr, -1)
            cv2.putText(img, text, (x + 2, ly - 2),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)

    cv2.addWeighted(overlay, 0.5, img, 0.5, 0, img)
    return img


# ── Inference ─────────────────────────────────────────────────────────────────
def run_box_inference(frame_bgr, conf=0.25, iou=0.45):
    model = get_det_model()
    results = model(frame_bgr, conf=conf, iou=iou, verbose=False)[0]
    boxes, labels, scores, class_ids = [], [], [], []
    for box in results.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        c   = float(box.conf[0])
        cid = int(box.cls[0])
        boxes.append([x1, y1, x2, y2])
        labels.append(model.names[cid])
        scores.append(round(c, 4))
        class_ids.append(cid)
    return boxes, labels, scores, class_ids


def run_seg_inference(frame_bgr, conf=0.25, iou=0.45):
    model = get_seg_model()
    results = model(frame_bgr, conf=conf, iou=iou, verbose=False)[0]
    masks, labels, scores, class_ids = [], [], [], []

    if results.masks is not None:
        h, w = frame_bgr.shape[:2]
        for i, box in enumerate(results.boxes):
            c   = float(box.conf[0])
            cid = int(box.cls[0])
            # Resize mask to frame size
            raw_mask = results.masks.data[i].cpu().numpy()
            resized  = cv2.resize(raw_mask, (w, h), interpolation=cv2.INTER_LINEAR)
            masks.append(resized)
            labels.append(model.names[cid])
            scores.append(round(c, 4))
            class_ids.append(cid)

    return masks, labels, scores, class_ids


def annotate(frame, draw_mode, conf=0.25, iou=0.45, hidden=None):
    """Run the right model and return (annotated_frame, labels, scores, class_ids)."""
    hidden = hidden or set()
    if draw_mode == "draw":
        masks, labels, scores, class_ids = run_seg_inference(frame, conf, iou)
        annotated = draw_masks(frame, masks, labels, scores, class_ids, hidden)
    else:
        boxes, labels, scores, class_ids = run_box_inference(frame, conf, iou)
        annotated = draw_boxes(frame, boxes, labels, scores, class_ids, hidden)
    return annotated, labels, scores, class_ids


# ── Helpers ───────────────────────────────────────────────────────────────────
def frame_to_b64(frame_bgr: np.ndarray) -> str:
    _, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return base64.b64encode(buf).decode()


def build_detections_payload(labels, scores, class_ids):
    counts = Counter(labels)
    items  = []
    for i, (lbl, sc, cid) in enumerate(zip(labels, scores, class_ids), 1):
        _, hex_col = color_for(cid)
        items.append({"index": i, "label": lbl, "score": sc, "color": hex_col})
    stats = [{"label": k, "count": v} for k, v in sorted(counts.items(), key=lambda x: -x[1])]
    return {"items": items, "stats": stats}


# ── Command handlers ──────────────────────────────────────────────────────────
def handle_detect_image(msg):
    path      = msg.get("path", "")
    conf      = float(msg.get("conf", 0.25))
    iou       = float(msg.get("iou",  0.45))
    mode      = msg.get("draw_mode", "box")

    frame = cv2.imread(path)
    if frame is None:
        send({"type": "error", "message": f"Cannot read image: {path}"}); return

    # Store original frame as b64 so JS can re-render with different hidden sets
    orig_b64 = frame_to_b64(frame)

    if mode == "draw":
        masks, labels, scores, class_ids = run_seg_inference(frame, conf, iou)
        annotated = draw_masks(frame, masks, labels, scores, class_ids)
        # Send polygon points for client-side re-render
        raw_items = []
        for mask, lbl, sc, cid in zip(masks, labels, scores, class_ids):
            _, hex_col = color_for(cid)
            mask_bin = (mask > 0.5).astype(np.uint8)
            contours, _ = cv2.findContours(mask_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            pts = []
            if contours:
                largest = max(contours, key=cv2.contourArea)
                pts = largest.reshape(-1, 2).tolist()
            raw_items.append({"label": lbl, "score": round(sc, 4), "color": hex_col, "points": pts})
    else:
        boxes, labels, scores, class_ids = run_box_inference(frame, conf, iou)
        annotated = draw_boxes(frame, boxes, labels, scores, class_ids)
        raw_items = []
        for (x1,y1,x2,y2), lbl, sc, cid in zip(boxes, labels, scores, class_ids):
            _, hex_col = color_for(cid)
            raw_items.append({"label": lbl, "score": round(sc, 4), "color": hex_col,
                               "box": [x1, y1, x2, y2]})

    send({
        "type":       "image_result",
        "image":      frame_to_b64(annotated),
        "orig_image": orig_b64,
        "draw_mode":  mode,
        "raw_items":  raw_items,
        "detections": build_detections_payload(labels, scores, class_ids),
    })


def handle_start_video(msg):
    global _cap, _stop_flag, _pause_flag, _seek_pos, _draw_mode, _conf, _hidden_labels
    path       = msg.get("path", "")
    _conf      = float(msg.get("conf", 0.25))
    iou        = float(msg.get("iou",  0.45))
    _draw_mode = msg.get("draw_mode", "box")
    _hidden_labels = set()

    stop_stream()
    _cap = cv2.VideoCapture(path)
    if not _cap.isOpened():
        send({"type": "error", "message": f"Cannot open video: {path}"}); return

    total = int(_cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps   = _cap.get(cv2.CAP_PROP_FPS) or 30
    _stop_flag = _pause_flag = False
    _seek_pos  = None
    threading.Thread(target=_stream_loop, args=(_conf, iou, "video_frame"), daemon=True).start()
    send({"type": "video_started", "total_frames": total, "fps": fps})


def handle_pause_video(msg):
    global _pause_flag
    _pause_flag = True
    send({"type": "video_paused"})


def handle_resume_video(msg):
    global _pause_flag
    _pause_flag = False
    send({"type": "video_resumed"})


def handle_seek_video(msg):
    global _seek_pos
    _seek_pos = int(msg.get("frame", 0))
    send({"type": "seek_ack", "frame": _seek_pos})


def handle_start_webcam(msg):
    global _cap, _stop_flag, _pause_flag, _seek_pos, _draw_mode, _conf, _hidden_labels
    _conf      = float(msg.get("conf", 0.25))
    iou        = float(msg.get("iou",  0.45))
    cam_index  = int(msg.get("cam", 0))
    _draw_mode = msg.get("draw_mode", "box")
    _hidden_labels = set()

    stop_stream()
    _cap = cv2.VideoCapture(cam_index)
    if not _cap.isOpened():
        send({"type": "error", "message": "Cannot open webcam"}); return

    _cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    _cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
    _stop_flag = _pause_flag = False
    _seek_pos  = None
    threading.Thread(target=_stream_loop, args=(_conf, iou, "webcam_frame"), daemon=True).start()
    send({"type": "webcam_started"})


def _stream_loop(conf: float, iou: float, frame_type: str):
    global _cap, _stop_flag, _pause_flag, _seek_pos, _draw_mode, _conf, _hidden_labels
    import datetime, time
    is_video     = (frame_type == "video_frame")
    total_frames = int(_cap.get(cv2.CAP_PROP_FRAME_COUNT)) if is_video else 0

    while not _stop_flag:
        if _cap is None or not _cap.isOpened():
            break
        if _seek_pos is not None:
            _cap.set(cv2.CAP_PROP_POS_FRAMES, _seek_pos)
            _seek_pos = None
        if _pause_flag:
            time.sleep(0.05); continue

        ret, frame = _cap.read()
        if not ret:
            send({"type": "stream_ended"}); break

        current_frame = int(_cap.get(cv2.CAP_PROP_POS_FRAMES))
        t0 = datetime.datetime.now()

        # Read live-updated params each frame
        cur_mode   = _draw_mode
        cur_conf   = _conf
        cur_hidden = set(_hidden_labels)

        annotated, labels, scores, class_ids = annotate(frame, cur_mode, cur_conf, iou, cur_hidden)
        fps_val = 1.0 / max((datetime.datetime.now() - t0).total_seconds(), 1e-6)
        cv2.putText(annotated, f"FPS: {fps_val:.1f}", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2, cv2.LINE_AA)

        payload = {
            "type":       frame_type,
            "image":      frame_to_b64(annotated),
            "detections": build_detections_payload(labels, scores, class_ids),
        }
        if is_video:
            payload["frame_pos"]    = current_frame
            payload["total_frames"] = total_frames
        send(payload)


def stop_stream():
    global _cap, _stop_flag, _pause_flag, _seek_pos
    _stop_flag = True
    _pause_flag = False
    _seek_pos   = None
    if _cap is not None:
        _cap.release()
        _cap = None


def handle_stop(msg):
    stop_stream()
    send({"type": "stopped"})


def handle_set_params(msg):
    """Hot-update draw mode, confidence, and/or hidden labels while a stream is running."""
    global _draw_mode, _conf, _hidden_labels
    if "draw_mode" in msg:
        _draw_mode = msg["draw_mode"]
    if "conf" in msg:
        _conf = float(msg["conf"])
    if "hidden_labels" in msg:
        _hidden_labels = set(msg["hidden_labels"])
    send({"type": "params_updated", "draw_mode": _draw_mode, "conf": _conf})


def handle_ping(msg):
    send({"type": "pong"})


HANDLERS = {
    "detect_image":  handle_detect_image,
    "start_video":   handle_start_video,
    "pause_video":   handle_pause_video,
    "resume_video":  handle_resume_video,
    "seek_video":    handle_seek_video,
    "start_webcam":  handle_start_webcam,
    "set_params":    handle_set_params,
    "stop":          handle_stop,
    "ping":          handle_ping,
}


# ── I/O ───────────────────────────────────────────────────────────────────────
def send(obj: dict):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    send({"type": "ready"})
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw: continue
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            send({"type": "error", "message": "Invalid JSON"}); continue
        handler = HANDLERS.get(msg.get("cmd", ""))
        if handler:
            handler(msg)
        else:
            send({"type": "error", "message": f"Unknown command: {msg.get('cmd')}"})


if __name__ == "__main__":
    main()
