# syntax=docker/dockerfile:1

# yt-dlp declares no postprocessors in handlers.py, so it never shells out and
# this image does not need ffmpeg — the audio is uploaded in whatever format
# was downloaded and the transcribe worker reads the content type.

FROM python:3.14-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# The app imports its own modules as top-level names (`from env import env`),
# matching how it runs as a script.
ENV PYTHONPATH=/app/app

RUN useradd --create-home --uid 10001 fetcher
USER fetcher

CMD ["python", "app/app.py"]
