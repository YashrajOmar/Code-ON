const testExecute = async () => {
  const code = `
#include <iostream>
using namespace std;
int main() {
  int a, b;
  if (cin >> a >> b) {
    cout << a + b << endl;
  }
  return 0;
}
  `;

  const payload = {
    code,
    language: "C++17",
    testCases: [
      { input: "3 4", expected: "7" },
      { input: "10 20", expected: "30" }
    ]
  };

  try {
    const res = await fetch("http://localhost:3000/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    console.log(text);
  } catch (err) {
    console.error(err);
  }
};

testExecute();
