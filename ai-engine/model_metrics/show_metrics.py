import json
import os
from datetime import datetime

def format_value(val):
    if isinstance(val, float):
        return f"{val:.4f}"
    return str(val)

def display_finetuned_metrics(json_path):
    print("\n" + "#" * 60)
    print("      SECTION 1: FINE-TUNED MODEL TRAINING LOGS      ")
    print("#" * 60)
    
    if not os.path.exists(json_path):
        print(f"[!] Notice: Fine-tuned training logs not found at {json_path}")
        return

    with open(json_path, 'r') as f:
        data = json.load(f)

    log_history = data.get("log_history", [])
    
    print(f"Model ID:     Qwen2.5-0.5B-Materials-Science")
    print(f"Total Steps:  {data.get('max_steps', 'N/A')}")
    print(f"Total Epochs: {round(data.get('num_train_epochs', 0), 2)}")
    print("-" * 60)
    
    print(f"{'Step':<8} | {'Loss':<10} | {'LR':<10} | {'Token Acc':<10}")
    print("-" * 60)

    for entry in log_history:
        if "loss" in entry:
            step = entry.get("step", "N/A")
            loss = round(entry.get("loss", 0), 4)
            lr = f"{entry.get('learning_rate', 0):.1e}"
            acc = round(entry.get("mean_token_accuracy", 0) * 100, 2)
            print(f"{step:<8} | {loss:<10} | {lr:<10} | {acc}%")

    if log_history:
        last = log_history[-1]
        print("-" * 60)
        print(f"FINAL TRAINING ACCURACY: {round(last.get('mean_token_accuracy', 0) * 100, 2)}%")

def display_rag_metrics(json_path):
    print("\n" + "#" * 60)
    print("      SECTION 2: RAG PIPELINE PERFORMANCE      ")
    print("#" * 60)
    
    if not os.path.exists(json_path):
        print(f"[!] Notice: RAG performance data not found at {json_path}")
        return

    with open(json_path, 'r') as f:
        data = json.load(f)

    retrieval = data.get("retrieval_metrics", {})
    generation = data.get("generation_metrics", {})

    print("RETRIEVAL (Pinecone + BGE-Small):")
    print(f" >> Hit Rate @ 10:    {retrieval.get('hit_rate_top10') * 100}%")
    print(f" >> Mean Recip Rank:  {retrieval.get('mrr')}")
    print(f" >> Avg Latency:      {retrieval.get('avg_latency_ms')} ms")
    
    print("\nGENERATION (Groq + Llama 3.1):")
    print(f" >> Faithfulness:     {generation.get('faithfulness') * 100}%")
    print(f" >> Answer Relevance: {generation.get('answer_relevance') * 100}%")
    print(f" >> Avg Sync Time:    {generation.get('avg_synthesis_time_ms')} ms")
    
    print("-" * 60)
    print(f"Benchmark Date: {data.get('benchmark_date')}")

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Paths
    ft_path = os.path.join(base_dir, "..", "models", "adapters", "qwen_adapters", "checkpoint-60", "trainer_state.json")
    rag_path = os.path.join(base_dir, "rag_metrics.json")
    
    print("\n" + "="*60)
    print("            QUOKKA AI SYSTEM METRICS DASHBOARD            ")
    print("="*60)
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    display_finetuned_metrics(ft_path)
    display_rag_metrics(rag_path)
    
    print("\n" + "="*60 + "\n")

if __name__ == "__main__":
    main()
