# Quokka Data Pipeline

This module handles the automated acquisition and preparation of materials science research data. 

*Note: The actual model training is performed in the cloud using the provided Colab notebooks.*

## 📁 Structure
- `extract.py`: Fetches papers from Semantic Scholar API.
- `preprocess.py`: Converts abstracts into structured Q&A pairs (Definition, Example, Key Points).
- `pipeline.py`: Orchestrates the full data preparation flow.

## 🚀 How to Run
To fetch new data and update the training set (`ai-engine/data/train.jsonl`), run:
```bash
python pipeline.py
```

## 🛠️ Data Format
The generated entries are formatted for instruction fine-tuning:
- **Instruction**: "Provide a clear definition, an example, and 3 key points..."
- **Input**: "Tell me about [Concept]."
- **Output**: 
    ```text
    Definition: ...
    Example: ...
    Key Points:
    1. ...
    2. ...
    3. ...
    ```
