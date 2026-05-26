FROM ghcr.io/ggml-org/llama.cpp:server

# Install curl/wget to download the model
RUN apt-get update && apt-get install -y wget && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# The HF repository containing your GGUF model. Update this if your repo name differs.
ENV MODEL_REPO="madhusudhan001/qwen2.5-0.5b-materials-science"
ENV MODEL_FILE="model-q8_0.gguf"

# Download the GGUF model directly from Hugging Face during the build process
RUN wget https://huggingface.co/${MODEL_REPO}/resolve/main/${MODEL_FILE} -O /app/model.gguf

# Expose port 7860 which is required by Hugging Face Spaces
EXPOSE 7860

# Ensure basic encoding
ENV LC_ALL=C.utf8

# Run the llama.cpp OpenAI-compatible server on port 7860
# -c 2048 defines context length
CMD ["--model", "/app/model.gguf", "--port", "7860", "--host", "0.0.0.0", "-c", "2048"]
