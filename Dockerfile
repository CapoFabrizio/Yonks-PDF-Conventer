FROM python:3.11-slim

# LibreOffice (headless) : nécessaire pour .odt / .rtf / .doc.
# Sans ce paquet, l'appli fonctionne quand même pour .docx et .txt
# (moteur pur Python), et désactive automatiquement les autres formats
# côté interface.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    fonts-dejavu \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY frontend/ frontend/

WORKDIR /app/backend

ENV CONVERTER_WORK_DIR=/data
RUN mkdir -p /data

EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
