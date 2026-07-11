import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# Load metadata
metadata_file = "printer_metadata.csv"
metadata = pd.read_csv(metadata_file, delimiter="\t", dtype=str)  # Read as strings

# Create a lookup dictionary for series ID and model name
metadata_dict = {row["id"]: (row["series"], row["model"]) for _, row in metadata.iterrows()}

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

# Plot the heatmap of the average matrix
plt.figure(figsize=(10, 8))
plt.imshow(avg_matrix, cmap="hot", interpolation="nearest")
plt.colorbar(label="Average Value")
plt.title("Average Heatmap of All Dot Matrices")
plt.xlabel("Column Index")
plt.ylabel("Row Index")
plt.show()


# Ensure target.txt exists
if "target.txt" in matrices:
    target_matrix = matrices["target.txt"]

    # Calculate total difference between target and all other matrices
    differences = []
    for file, matrix in matrices.items():
        diff = np.sum(np.abs(target_matrix - matrix))  # Sum of absolute differences

        # Extract series and model info
        file_id = file.replace(".txt", "")
        print(metadata_dict)
        if file_id in metadata_dict:
            series, model = metadata_dict[file_id]
        else:
            series, model = "???", "???"

        differences.append((file, series, model, diff))

    # Sort differences from smallest to largest
    sorted_differences = sorted(differences, key=lambda x: x[3])

    # Convert results to DataFrame and print
    df_differences = pd.DataFrame(sorted_differences, columns=["File", "Series ID", "Model Name", "Total Difference"])
    print(df_differences.to_string(index=False))
else:
    print("Error: target.txt is missing.")
