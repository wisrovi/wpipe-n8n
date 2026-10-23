import io
import zipfile

from app.schemas.ir import TargetIR


def build_microservice_zip(target_ir: TargetIR) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in target_ir.files:
            zf.writestr(file.path, file.content)
    buffer.seek(0)
    return buffer.getvalue()
