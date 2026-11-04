"""Create test photos, including one with GPS EXIF, for the evidence-pack tests."""

from pathlib import Path

from PIL import Image, ImageDraw
from PIL.TiffImagePlugin import IFDRational

HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)


def gradient(width, height, start, end):
    image = Image.new("RGB", (width, height), start)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(1, height - 1)
        color = tuple(round(start[i] + (end[i] - start[i]) * t) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color)
    return image


def make_gps_photo():
    image = gradient(3000, 2000, (214, 196, 160), (120, 135, 150))
    draw = ImageDraw.Draw(image)
    draw.rectangle([700, 500, 2300, 1500], outline=(180, 60, 30), width=18)
    draw.line([(700, 1000), (2300, 1000)], fill=(30, 30, 30), width=8)
    draw.text((760, 540), "NORTH WALL - BEFORE", fill=(20, 20, 20))
    draw.text((760, 1560), "Test image with GPS EXIF", fill=(240, 240, 240))

    exif = Image.Exif()
    exif[274] = 1
    exif[36867] = "2026:11:03 14:22:10"
    exif[36868] = "2026:11:03 14:22:10"
    exif[271] = "TestCam"
    exif[272] = "Fixture 3000"
    gps = {
        1: "N",
        2: (IFDRational(37, 1), IFDRational(46, 1), IFDRational(2999, 100)),
        3: "W",
        4: (IFDRational(122, 1), IFDRational(25, 1), IFDRational(1200, 100)),
        5: b"\x00",
        6: (IFDRational(0, 1),),
    }
    exif[34853] = gps
    path = ARTIFACTS / "photo_gps.jpg"
    image.save(path, "JPEG", quality=90, exif=exif)
    return path


def make_plain_photo():
    image = gradient(1600, 1200, (190, 205, 210), (85, 105, 120))
    draw = ImageDraw.Draw(image)
    draw.rectangle([260, 260, 1340, 940], outline=(245, 240, 225), width=14)
    draw.text((300, 300), "ISLAND WALL - AFTER ROUGH-IN", fill=(20, 20, 20))
    draw.ellipse([1120, 720, 1260, 860], fill=(245, 180, 70))
    path = ARTIFACTS / "photo_plain.jpg"
    image.save(path, "JPEG", quality=90)
    return path


def make_png():
    image = gradient(1200, 1600, (170, 190, 180), (70, 80, 95))
    draw = ImageDraw.Draw(image)
    draw.rectangle([150, 300, 1050, 1250], outline=(255, 255, 255), width=10)
    draw.text((190, 340), "VERTICAL PNG FIXTURE", fill=(255, 255, 255))
    path = ARTIFACTS / "photo_vertical.png"
    image.save(path, "PNG")
    return path


def prepare(src, dst, max_edge=1600):
    """Mimic what the browser does: downscale, strip metadata, re-encode JPEG."""
    with Image.open(src) as image:
        image = image.convert("RGB")
        image.thumbnail((max_edge, max_edge), Image.LANCZOS)
        image.save(dst, "JPEG", quality=85)
        return image.size, dst.stat().st_size


if __name__ == "__main__":
    gps_path = make_gps_photo()
    plain_path = make_plain_photo()
    png_path = make_png()

    gps_prepared = ARTIFACTS / "prepared_photo_gps.jpg"
    plain_prepared = ARTIFACTS / "prepared_photo_plain.jpg"
    print("prepared gps:", prepare(gps_path, gps_prepared))
    print("prepared plain:", prepare(plain_path, plain_prepared))

    with Image.open(gps_path) as image:
        exif = image.getexif()
        gps_ifd = exif.get_ifd(34853)
        print("gps photo:", image.size, "bytes:", gps_path.stat().st_size)
        print("gps tags present:", bool(gps_ifd), "lat ref:", gps_ifd.get(1), "lon ref:", gps_ifd.get(3))
        print("orientation:", exif.get(274), "datetime:", exif.get(36867))
    with Image.open(plain_path) as image:
        print("plain photo:", image.size, "exif bytes:", len(image.getexif().tobytes()))
    with Image.open(png_path) as image:
        print("png fixture:", image.size)
    print("fixtures in", ARTIFACTS)
