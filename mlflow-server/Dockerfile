FROM python:3.12-slim
RUN pip install --no-cache-dir "mlflow>=3.0,<4"
WORKDIR /mlflow
EXPOSE 5000
# Host headers are checked (DNS-rebinding protection), so the in-cluster and compose names are listed explicitly.
# One container, SQLite for metadata, a local folder for artifacts. Fine for a lab; a team would use Postgres and object storage.
# MLflow 3 starts a background job runner and several consumer processes (about 230 MB each) that this project
# does not use. With them the server needs about 1.7 GiB and was OOMKilled under a 1 GiB limit on Kubernetes;
# without them it uses about 550 MiB.
ENV MLFLOW_SERVER_ENABLE_JOB_EXECUTION=false
CMD ["mlflow", "server", "--host", "0.0.0.0", "--port", "5000", \
     "--backend-store-uri", "sqlite:////mlflow/data/mlflow.db", \
     "--artifacts-destination", "/mlflow/data/artifacts", \
     "--serve-artifacts", \
     "--allowed-hosts", "localhost,localhost:5000,127.0.0.1:5000,mlflow,mlflow:5000,mlflow.mlops-lab,mlflow.mlops-lab:5000,mlflow.mlops-lab.svc,mlflow.mlops-lab.svc:5000,mlflow.mlops-lab.svc.cluster.local,mlflow.mlops-lab.svc.cluster.local:5000"]
