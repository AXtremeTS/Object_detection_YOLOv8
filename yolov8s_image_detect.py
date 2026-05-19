"""
YOLOv8s Object Detection
Nhận diện đồ vật trong hình ảnh sử dụng YOLOv8s

Cài đặt:
    pip install ultralytics opencv-python pillow matplotlib

Sử dụng:
    python yolov8s_detect.py --image path/to/image.jpg
    python yolov8s_detect.py --image path/to/image.jpg --conf 0.5 --save
"""
import argparse
import cv2
import numpy as np
from pathlib import Path
from PIL import Image
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from ultralytics import YOLO


# ─── Màu sắc cho từng class (BGR) ───────────────────────────────────────────
COLORS = [
    (56, 139, 253), (255, 99, 71),  (50, 205, 50),  (255, 165, 0),
    (147, 112, 219),(0, 206, 209),  (255, 20, 147), (100, 149, 237),
    (154, 205, 50), (255, 215, 0),  (127, 255, 0),  (0, 191, 255),
]


def get_color(class_id: int) -> tuple:
    return COLORS[class_id % len(COLORS)]


def load_model(model_path: str = "yolov8s.pt") -> YOLO:
    """
    Load model YOLOv8s.
    Lần đầu chạy sẽ tự động tải weights từ Ultralytics.
    """
    print(f"[INFO] Đang load model: {model_path}")
    model = YOLO(model_path)
    print(f"[INFO] Load model thành công!")
    return model


def detect_objects(
    model: YOLO,
    image_path: str,
    conf_threshold: float = 0.25,
    iou_threshold: float = 0.45,
) -> dict:
    """
    Chạy nhận diện đồ vật trên một ảnh.

    Args:
        model:           Model YOLOv8 đã load
        image_path:      Đường dẫn đến file ảnh
        conf_threshold:  Ngưỡng confidence (0-1)
        iou_threshold:   Ngưỡng IoU cho NMS (0-1)

    Returns:
        dict chứa: image_bgr, boxes, labels, scores, class_ids
    """
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"Không tìm thấy ảnh: {image_path}")

    # Đọc ảnh gốc
    image_bgr = cv2.imread(str(image_path))
    if image_bgr is None:
        raise ValueError(f"Không thể đọc ảnh: {image_path}")

    print(f"[INFO] Đang xử lý: {image_path.name} ({image_bgr.shape[1]}×{image_bgr.shape[0]})")

    # Chạy inference
    results = model(
        str(image_path),
        conf=conf_threshold,
        iou=iou_threshold,
        verbose=False,
    )[0]

    boxes     = []
    labels    = []
    scores    = []
    class_ids = []

    for box in results.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        conf     = float(box.conf[0])
        cls_id   = int(box.cls[0])
        cls_name = model.names[cls_id]

        boxes.append((x1, y1, x2, y2))
        labels.append(cls_name)
        scores.append(conf)
        class_ids.append(cls_id)

    print(f"[INFO] Phát hiện {len(boxes)} đối tượng.")
    return {
        "image_bgr": image_bgr,
        "boxes":     boxes,
        "labels":    labels,
        "scores":    scores,
        "class_ids": class_ids,
        "image_name": image_path.stem,
    }


def draw_detections(result: dict, line_thickness: int = 2) -> np.ndarray:
    """
    Vẽ bounding box và nhãn lên ảnh.

    Returns:
        Ảnh BGR đã được vẽ annotations
    """
    image = result["image_bgr"].copy()

    for (x1, y1, x2, y2), label, score, cls_id in zip(
        result["boxes"], result["labels"], result["scores"], result["class_ids"]
    ):
        color = get_color(cls_id)
        text  = f"{label} {score:.2f}"

        # Vẽ bounding box
        cv2.rectangle(image, (x1, y1), (x2, y2), color, line_thickness)

        # Vẽ background cho label
        (tw, th), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        label_y = max(y1 - 4, th + baseline)
        cv2.rectangle(
            image,
            (x1, label_y - th - baseline),
            (x1 + tw + 4, label_y + baseline - 2),
            color, -1,
        )

        # Vẽ text nhãn
        cv2.putText(
            image, text,
            (x1 + 2, label_y - 2),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1,
            cv2.LINE_AA,
        )

    return image


def visualize(result: dict, save_path: str = None, show: bool = True):
    """
    Hiển thị kết quả bằng matplotlib (hỗ trợ Unicode tốt hơn OpenCV).
    """
    annotated = draw_detections(result)
    image_rgb = cv2.cvtColor(annotated, cv2.COLOR_BGR2RGB)

    fig, axes = plt.subplots(1, 2, figsize=(16, 7))
    fig.patch.set_facecolor("#0f1117")

    # Ảnh gốc
    axes[0].imshow(cv2.cvtColor(result["image_bgr"], cv2.COLOR_BGR2RGB))
    axes[0].set_title("Ảnh gốc", color="white", fontsize=13, pad=10)
    axes[0].axis("off")

    # Ảnh kết quả
    axes[1].imshow(image_rgb)
    axes[1].set_title(
        f"YOLOv8s — {len(result['boxes'])} đối tượng phát hiện",
        color="white", fontsize=13, pad=10,
    )
    axes[1].axis("off")

    plt.tight_layout(pad=1.5)

    if save_path:
        plt.savefig(save_path, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
        print(f"[INFO] Đã lưu kết quả: {save_path}")

    if show:
        plt.show()

    plt.close()


def print_summary(result: dict):
    """In bảng tổng kết các đối tượng được phát hiện."""
    from collections import Counter

    if not result["labels"]:
        print("\n[RESULT] Không phát hiện đối tượng nào.")
        return

    print("\n" + "=" * 50)
    print(f"  KẾT QUẢ NHẬN DIỆN — {result['image_name']}")
    print("=" * 50)
    print(f"  {'#':<4} {'Đối tượng':<20} {'Độ tin cậy':>12}")
    print("-" * 50)

    for i, (label, score) in enumerate(zip(result["labels"], result["scores"]), 1):
        bar = "█" * int(score * 20)
        print(f"  {i:<4} {label:<20} {score:>8.1%}  {bar}")

    print("-" * 50)
    counts = Counter(result["labels"])
    print("  Thống kê:")
    for name, count in sorted(counts.items(), key=lambda x: -x[1]):
        print(f"    • {name}: {count}")
    print("=" * 50 + "\n")


# ─── CLI ─────────────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="YOLOv8s Object Detection — Nhận diện đồ vật trong ảnh",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--image",  required=True, help="Đường dẫn ảnh đầu vào")
    parser.add_argument("--model",  default="yolov8s.pt", help="File model (.pt)")
    parser.add_argument("--conf",   type=float, default=0.25, help="Ngưỡng confidence")
    parser.add_argument("--iou",    type=float, default=0.45, help="Ngưỡng IoU (NMS)")
    parser.add_argument("--save",   action="store_true", help="Lưu ảnh kết quả")
    parser.add_argument("--no-show", action="store_true", help="Không hiển thị cửa sổ ảnh")
    return parser.parse_args()


def main():
    args = parse_args()

    # Load model
    model = load_model(args.model)

    # Nhận diện
    result = detect_objects(
        model, args.image,
        conf_threshold=args.conf,
        iou_threshold=args.iou,
    )

    # In tổng kết
    print_summary(result)

    # Lưu / hiển thị
    save_path = None
    if args.save:
        out_name  = f"{result['image_name']}_yolov8s_result.jpg"
        save_path = str(Path(args.image).parent / out_name)

    visualize(result, save_path=save_path, show=not args.no_show)


if __name__ == "__main__":
    main()
