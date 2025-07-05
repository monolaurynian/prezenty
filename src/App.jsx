
import { useState, useEffect } from 'react';
import { GoogleOAuthProvider, GoogleLogin, googleLogout } from '@react-oauth/google';
import jwt_decode from 'jwt-decode';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectItem } from "@/components/ui/select";

const BACKGROUND_IMAGE = "/placeholder-background.jpg"; // Change this later

const RecipientsManager = ({ recipients, setRecipients }) => {
  const [newRecipient, setNewRecipient] = useState('');

  const addRecipient = () => {
    if (newRecipient.trim() && !recipients.includes(newRecipient)) {
      setRecipients([...recipients, newRecipient]);
      setNewRecipient('');
    }
  };

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-bold text-white">Zarządzaj osobami</h2>
      <div className="flex gap-2">
        <Input value={newRecipient} onChange={e => setNewRecipient(e.target.value)} placeholder="Nowa osoba" />
        <Button onClick={addRecipient}>Dodaj</Button>
      </div>
      <ul className="text-white">
        {recipients.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState(null);
  const [recipients, setRecipients] = useState(["Mama", "Tata", "Siostra"]);
  const [form, setForm] = useState({ prezent: '', dla: '', dodatkowe: '' });
  const [presents, setPresents] = useState([]);

  const submitPresent = () => {
    if (!form.prezent || !form.dla) return;
    setPresents([...presents, { ...form, checked: false }]);
    setForm({ prezent: '', dla: '', dodatkowe: '' });
  };

  const toggleChecked = (index) => {
    const newPresents = [...presents];
    newPresents[index].checked = !newPresents[index].checked;
    setPresents(newPresents);
  };

  return (
    <GoogleOAuthProvider clientId="869623440585-1v0ic6989jcekgputrnvj08og7ehnram.apps.googleusercontent.com">
      <div className="min-h-screen bg-cover bg-center p-6" style={{ backgroundImage: `url(${BACKGROUND_IMAGE})` }}>
        <div className="max-w-3xl mx-auto space-y-6">
          {!user ? (
            <Card>
              <CardContent className="p-6 text-center">
                <p className="mb-4">Zaloguj się przez Google, aby kontynuować</p>
                <GoogleLogin
                  onSuccess={credentialResponse => {
                    const decoded = jwt_decode(credentialResponse.credential);
                    setUser(decoded);
                  }}
                  onError={() => alert("Błąd logowania")}
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex justify-between items-center text-white">
                <h1 className="text-3xl font-bold">🎄 Prezenty</h1>
                <Button onClick={() => { setUser(null); googleLogout(); }}>Wyloguj</Button>
              </div>

              <Card>
                <CardContent className="p-6 space-y-4">
                  <h2 className="text-xl font-semibold">Dodaj pomysł na prezent</h2>
                  <Input placeholder="Jaki prezent?" value={form.prezent} onChange={e => setForm({ ...form, prezent: e.target.value })} />
                  <Select value={form.dla} onValueChange={val => setForm({ ...form, dla: val })}>
                    {recipients.map((r, i) => <SelectItem key={i} value={r}>{r}</SelectItem>)}
                  </Select>
                  <Textarea placeholder="Dodatkowe informacje" value={form.dodatkowe} onChange={e => setForm({ ...form, dodatkowe: e.target.value })} />
                  <Button onClick={submitPresent}>Dodaj</Button>
                </CardContent>
              </Card>

              <RecipientsManager recipients={recipients} setRecipients={setRecipients} />

              <Card>
                <CardContent className="p-6 space-y-4">
                  <h2 className="text-xl font-semibold">Lista pomysłów</h2>
                  <ul className="space-y-2">
                    {presents.map((p, i) => (
                      <li key={i} className="flex gap-2 items-center text-white">
                        <input type="checkbox" checked={p.checked} onChange={() => toggleChecked(i)} />
                        <span className={p.checked ? "line-through" : ""}>{p.prezent} dla {p.dla} ({p.dodatkowe})</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </GoogleOAuthProvider>
  );
}
