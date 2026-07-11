import os
import numpy as np
import pandas as pd
import argparse
from sklearn.decomposition import PCA
import matplotlib.pyplot as plt
import seaborn as sns

# Argument parser for command-line input
parser = argparse.ArgumentParser(description="Run PCA on printer dot matrices with optional row removal.")
parser.add_argument("--remove_rows", type=int, default=0, help="Number of top rows to remove from each matrix (default=0)")
args = parser.parse_args()

# Load metadata
metadata_file = "printer_metadata.csv"

try:
    metadata = pd.read_csv(metadata_file, delimiter="\t", dtype=str, engine="python")
    metadata_dict = {row["id"]: (row["series"], row["model"], row["brand"]) for _, row in metadata.iterrows()}
except Exception as e:
    print(f"Error reading CSV: {e}")
    metadata_dict = {}

# Directory containing the dot files
dot_files_dir = "./manual_dots"

# Get list of all text files in the directory (including target.txt and seadra.txt)
dot_files = [f for f in os.listdir(dot_files_dir) if f.endswith(".txt")]

# Initialize a dictionary to store matrices
matrices = {}

# Read each file and store the grid as a numpy array
for file in dot_files:
    if file.startswith("2") : continue

    file_path = os.path.join(dot_files_dir, file)
    with open(file_path, "r") as f:

        matrix = np.array([list(map(int, line.split())) for line in f.readlines()])
        
        # Remove the top N rows if specified
        if args.remove_rows > 0:
            matrix = matrix[args.remove_rows:, :]
        
        matrices[file] = matrix

# Ensure target and seadra are included
special_files = ["target.txt", "seadra.txt"]

# Prepare data matrix for PCA
matrix_list = []
labels = []
series_names = []
brand_names = []

for file in dot_files:
    if file.startswith("2") : continue
    matrix = matrices[file].flatten()  # Flatten the 2D matrix into a 1D vector

    # Extract series and model info
    file_id = file.replace(".txt", "")
    if file_id in metadata_dict:
        series, model, brand = metadata_dict[file_id]
    else:
        series, model, brand = 0, "??", "??"  # Use file name for special files
    
    matrix_list.append(matrix)
    labels.append(str(file_id) + " " + model)
    brand_names.append(brand)
    series_names.append(series)

# Convert to NumPy array
data_matrix = np.array(matrix_list)

# Perform PCA
pca = PCA(n_components=2)
pca_result = pca.fit_transform(data_matrix)

# Create a dataframe for plotting
df_pca = pd.DataFrame({
    "PC1": pca_result[:, 0],
    "PC2": pca_result[:, 1],
    "Model": labels,
    "Series": series_names,
    "Brand": brand_names,
})

# Plot PCA
plt.figure(figsize=(10, 7))
sns.scatterplot(
    x="PC1", y="PC2", hue="Series", style="Brand",
    data=df_pca, palette="tab10", s=100, alpha=0.8
)

# Annotate points with model names
for i, row in df_pca.iterrows():
    plt.text(row["PC1"], row["PC2"], row["Model"], fontsize=9, ha='right')

plt.title(f"PCA of Printer Dot Matrices (Removed {args.remove_rows} Rows)")
plt.xlabel("Principal Component 1")
plt.ylabel("Principal Component 2")
plt.legend(title="Series", bbox_to_anchor=(1.05, 1), loc="upper left")
plt.grid(True)
plt.show()

