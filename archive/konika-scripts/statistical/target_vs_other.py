import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# Load metadata
metadata_file = "printer_metadata.csv"
metadata = pd.read_csv(metadata_file, delimiter="\t", dtype=str)

# Directory containing the dot files
dot_files_dir = "./manual_dots"

# Get list of all text files in the directory
dot_files = [f for f in os.listdir(dot_files_dir) if f.endswith(".txt")]

# Initialize a dictionary to store matrices
matrices = {}

# Read each file and store the grid as a numpy array
for file in dot_files:
    file_path = os.path.join(dot_files_dir, file)
    with open(file_path, "r") as f:
        matrix = np.array([list(map(int, line.split())) for line in f.readlines()])
        matrices[file] = matrix

# Convert matrices to a 3D numpy array (num_files x rows x cols)
all_matrices = np.array(list(matrices.values()))

# Compute the average matrix across all files
avg_matrix_all = np.mean(all_matrices, axis=0)

# Separate target and seadra matrices
target_matrix = matrices.get("target.txt", None)
seadra_matrix = matrices.get("seadra.txt", None)

# Filter out target and seadra from general comparison set
other_matrices = [matrices[file] for file in matrices if file not in ["target.txt", "seadra.txt"]]
avg_matrix_other = np.mean(other_matrices, axis=0) if other_matrices else None

# Compute the average of target and seadra combined
if target_matrix is not None and seadra_matrix is not None:
    avg_matrix_target_seadra = np.mean([target_matrix, seadra_matrix], axis=0)
else:
    avg_matrix_target_seadra = None

# Compute the difference between target+seadra and other matrices
if avg_matrix_target_seadra is not None and avg_matrix_other is not None:
    diff_matrix = avg_matrix_target_seadra - avg_matrix_other
else:
    diff_matrix = None

# Plot the results
fig, axes = plt.subplots(1, 3, figsize=(18, 6))

# Plot Target+Seadra average
if avg_matrix_target_seadra is not None:
    axes[0].imshow(avg_matrix_target_seadra, cmap="hot", interpolation="nearest")
    axes[0].set_title("Target + Seadra Average")
    axes[0].set_xlabel("Column Index")
    axes[0].set_ylabel("Row Index")

# Plot Other Matrices average
if avg_matrix_other is not None:
    axes[1].imshow(avg_matrix_other, cmap="hot", interpolation="nearest")
    axes[1].set_title("Other Matrices Average")
    axes[1].set_xlabel("Column Index")
    axes[1].set_ylabel("Row Index")

# Plot the difference between the averages
if diff_matrix is not None:
    axes[2].imshow(diff_matrix, cmap="bwr", interpolation="nearest")  # Blue-White-Red for differences
    axes[2].set_title("Difference (Target+Seadra - Others)")
    axes[2].set_xlabel("Column Index")
    axes[2].set_ylabel("Row Index")

plt.tight_layout()
plt.show()

