from json import load
from os import listdir
from matplotlib import pyplot as plt

files = listdir('./data')
for name in files:
    path = './data/' + name
    with open(path, 'r') as file:
        data = load(file)
        X = list(map(int, data['graph']['X']))
        Y = list(map(int, data['graph']['Y']))
        plt.plot(X, Y)
        opt_vault = int(data['graph']['liquidatedVault'])
        opt_profit = int(data['graph']['attainedProfit'])
        plt.scatter([opt_vault], [opt_profit], color='green')
        print("opt vault: ", opt_vault)
        print("opt profit:", opt_profit)
        plt.show()
        x = input('quit? (q)')
        if x == 'q':
            break