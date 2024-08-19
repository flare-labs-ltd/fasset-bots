# Installing MySQL

## 1. Installing MySQL on Windows

MySQL provides an installer package that includes MySQL Server, MySQL Workbench (GUI tool), MySQL Shell, MySQL Router, and other components.

### Steps:

1. **Download MySQL Installer:**
   - Go to the [MySQL Community Downloads](https://dev.mysql.com/downloads/mysql/) page.
   - Download the MySQL Installer for Windows.

2. **Run the Installer:**
   - Once downloaded, run the installer package.
   - Follow the installer wizard steps. It will guide you through setting up MySQL Server.

3. **Configuration:**
   - During installation, you will set up a root password for MySQL Server.

4. **Complete Installation:**
   - Once installation is complete, MySQL Server should be running as a Windows service.
   - You can access MySQL using MySQL Workbench or other MySQL client tools.

## 2. Installing MySQL on macOS

### Using Homebrew

If you have Homebrew installed, you can easily install MySQL using the command line:

1. **Open Terminal:**
   - Open Terminal on your macOS.

2. **Install MySQL:**
   - Run the following command in Terminal to install MySQL:
     ```bash
     brew install mysql
     ```

3. **Start MySQL Service:**
   - After installation completes, start the MySQL service:
     ```bash
     brew services start mysql
     ```

## 3. Installing MySQL on Linux

### Using APT Package Manager (Ubuntu)

1. **Update APT Repository:**
   - Open Terminal.
   - Run:
     ```bash
     sudo apt-get update
     ```

2. **Install MySQL Server:**
   - Run:
     ```bash
     sudo apt-get install mysql-server
     ```

3. **Start MySQL Service:**
   - After installation, MySQL should start automatically. If not, start it manually:
     ```bash
     sudo systemctl start mysql
     ```

## Verifying Installation

After installation, you can verify MySQL is running and connect to it using MySQL Workbench or command-line tools (mysql client).

- **Command Line:**
  ```bash
  mysql -u root -p

# Setting Up MySQL for Fasset-Bots

## Creating a New User in MySQL

First, we need to create a new user in MySQL that will be used by `fasset-bots` to connect to the database. In this example, we are going to create a user with the username `fassetbot` and password `VerySafePassword` on `localhost`.

### Steps:

1. **Connect to MySQL:**
   - Open your terminal or command prompt and log in to MySQL using the `mysql` command with appropriate credentials:
     ```bash
     mysql -u root -p
     ```

2. **Create a New User:**
   - Once logged in to MySQL, you can create a new user using the `CREATE USER` command. For example, to create a user named `fassetbot` with the password `VerySafePassword`:
     ```sql
     CREATE USER 'fassetbot'@'localhost' IDENTIFIED BY 'VerySafePassword';
     ```

3. **Grant Privileges:**
   - After creating the user, you need to grant appropriate privileges to the user. Use the `GRANT` statement to give permissions to the user. For example, to grant all privileges on all databases:
     ```sql
     GRANT ALL PRIVILEGES ON fasset_bots.* TO 'fassetbot'@'localhost' WITH GRANT OPTION;
     ```

4. **Flush Privileges:**
   - After granting privileges, flush the privileges to ensure that MySQL reloads the grant tables and applies your changes:
     ```sql
     FLUSH PRIVILEGES;
     ```

5. **Exit MySQL:**
   - After adding the new user and granting privileges, you can exit the MySQL prompt by typing:
     ```bash
     exit;
     ```
The created user will be used by agent bot to access the database. The credentials will need to be written in `secrets.json`.
