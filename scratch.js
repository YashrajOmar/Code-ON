const url = 'https://codeforces.com/problemset/problem/2000/D';
fetch(url).then(r => r.text()).then(html => {
  const sampleTestMatch = html.match(/<div class="sample-test">([\s\S]*?)<\/div>\s*<\/div>/);
  if (sampleTestMatch) {
    const sampleHtml = sampleTestMatch[1];
    const inputs = [...sampleHtml.matchAll(/<div class="input">[\s\S]*?<pre>([\s\S]*?)<\/pre>/gi)];
    const outputs = [...sampleHtml.matchAll(/<div class="output">[\s\S]*?<pre>([\s\S]*?)<\/pre>/gi)];
    console.log(`Found ${inputs.length} inputs and ${outputs.length} outputs`);
    for (let i = 0; i < inputs.length; i++) {
        // CF uses <div class="test-example-line"> for multiline sometimes, or just <br>
        const cleanInput = inputs[i][1].replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim();
        const cleanOutput = outputs[i] ? outputs[i][1].replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim() : '';
        console.log(`Example ${i+1}:`);
        console.log(`Input:\n${cleanInput}`);
        console.log(`Output:\n${cleanOutput}`);
    }
  } else {
    console.log("No sample-test div found");
  }
});
