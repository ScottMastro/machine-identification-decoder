import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier, plot_tree
from sklearn.metrics import accuracy_score, classification_report

# Load metadata
metadata_file = "printer_metadata.csv"
metadata = pd.read_csv(metadata_file, delimiter="\t", dtype=str, engine="python")

# Create target variable (1 if serial starts with "5311", else 0)
metadata["target"] = metadata["model"].apply(lambda x: 1 if isinstance(x, str) and x.startswith("Magicolor 2300 DL") else 0)

# Directory containing the dot files
dot_files_dir = "./manual_dots"

# Get list of all text files in the directory
dot_files = [f for f in os.listdir(dot_files_dir) if f.endswith(".txt")]

# Initialize storage for matrix data
matrix_list = []
labels = []

# Read each file and convert matrix to a flattened vector
for file in dot_files:
    file_id = file.replace(".txt", "")
    
    # Skip files that are not in the metadata
    if file_id not in metadata["id"].values:
        continue
    
    file_path = os.path.join(dot_files_dir, file)
    with open(file_path, "r") as f:
        matrix = np.array([list(map(int, line.split())) for line in f.readlines()])
    
    # Flatten the matrix into a single row of features
    matrix_list.append(matrix.flatten())
    
    # Get the target label (1 for "5311", 0 otherwise)
    labels.append(metadata.loc[metadata["id"] == file_id, "target"].values[0])

# Convert extracted features into a DataFrame
df_features = pd.DataFrame(matrix_list)
df_features["Target"] = labels  # Add target labels

# Split data into training and testing sets
X = df_features.drop(columns=["Target"])  # All dot positions are features
y = df_features["Target"]
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train a decision tree classifier
clf = DecisionTreeClassifier(max_depth=5, random_state=42)
clf.fit(X_train, y_train)

# Predict on the test set
y_pred = clf.predict(X_test)

# Evaluate the model
print("Accuracy:", accuracy_score(y_test, y_pred))
print(classification_report(y_test, y_pred))

# Visualize the decision tree
plt.figure(figsize=(12, 6))
plot_tree(clf, max_depth=3, filled=True, rounded=True)
plt.title("Decision Tree Based on Individual Dot Positions")
plt.show()

