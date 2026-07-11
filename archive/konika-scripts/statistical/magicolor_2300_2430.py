import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# Load metadata
metadata_file = "printer_metadata.csv"
metadata = pd.read_csv(metadata_file, delimiter="\t", dtype=str)  # Read as strings

# Create a lookup dictionary for series ID and model name
metadata_dict = {row["id"]: (row["series"], row["model"], row["serial"], row["brand"]) for _, row in metadata.iterrows()}

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

# Compute the average matrix
all_matrices = np.array(list(matrices.values()))
avg_matrix = np.mean(all_matrices, axis=0)


# Filter metadata for Magicolor 2300 DL and Magicolor 2430 DL
magicolor_2300_files = [file for file, (_, model, serial, brand) in metadata_dict.items() if model.startswith("Bizhub")]
magicolor_2430_files = [file for file, (_, model, serial, brand) in metadata_dict.items() if not model.startswith("Bizhub")]

# Count the number of each model
num_2300 = len(magicolor_2300_files)
num_2430 = len(magicolor_2430_files)

# Extract matrices for each model
matrices_2300 = [matrices[f"{file}.txt"] for file in magicolor_2300_files if f"{file}.txt" in matrices]
matrices_2430 = [matrices[f"{file}.txt"] for file in magicolor_2430_files if f"{file}.txt" in matrices]

# Compute the average matrices for each model
avg_matrix_2300 = np.mean(matrices_2300, axis=0) if matrices_2300 else None
avg_matrix_2430 = np.mean(matrices_2430, axis=0) if matrices_2430 else None

# Compute the difference between the averages
if avg_matrix_2300 is not None and avg_matrix_2430 is not None:
    diff_matrix = avg_matrix_2300 - avg_matrix_2430
else:
    diff_matrix = None 

# Plot the results
fig, axes = plt.subplots(1, 3, figsize=(18, 6))

# Plot Magicolor 2300 DL average
if avg_matrix_2300 is not None:
    axes[0].imshow(avg_matrix_2300, cmap="hot", interpolation="nearest")
    axes[0].set_title(f"Magicolor 2300 DL (n={num_2300})")
    axes[0].set_xlabel("Column Index")
    axes[0].set_ylabel("Row Index")

# Plot Magicolor 2430 DL average
if avg_matrix_2430 is not None:
    axes[1].imshow(avg_matrix_2430, cmap="hot", interpolation="nearest")
    axes[1].set_title(f"Magicolor 2430 DL (n={num_2430})")
    axes[1].set_xlabel("Column Index")
    axes[1].set_ylabel("Row Index")

# Plot the difference between the averages
if diff_matrix is not None:
    axes[2].imshow(diff_matrix, cmap="bwr", interpolation="nearest")  # Blue-White-Red for differences
    axes[2].set_title("Difference (2300 DL - 2430 DL)")
    axes[2].set_xlabel("Column Index")
    axes[2].set_ylabel("Row Index")

plt.tight_layout()
plt.show()


