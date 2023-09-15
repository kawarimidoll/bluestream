FROM docker.io/denoland/deno

# The port that your application listens to.
EXPOSE 8000

WORKDIR /app

# Prefer not to run as root.
USER deno

# Cache the dependencies as a layer (the following two steps are re-run only when deps.ts is modified).
# Ideally cache deps.ts will download and compile _all_ external files used in main.ts.
COPY . .
RUN deno cache server.ts

CMD ["run", "--allow-net", "--allow-env", "--allow-read", "server.ts"]
