FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir 'psycopg[binary]==3.2.13'
COPY source_connector.py source-connector.sql install.py ./
USER 65534:65534
ENTRYPOINT ["python", "source_connector.py"]
